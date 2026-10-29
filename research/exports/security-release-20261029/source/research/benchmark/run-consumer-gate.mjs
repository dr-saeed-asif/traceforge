#!/usr/bin/env node
/**
 * Consumer-path evaluation: a second agent receives each benchmark session's
 * artifact plus a signed claim record and decides ACCEPT / REVIEW / REJECT
 * with the MCP gate's policy (`decideOnClaimRecord`). Run after
 * run-controlled-benchmark.mjs; reads its sessions.jsonl and rows.jsonl.
 *
 * A session is "safe to accept" when every gold claim is VERIFIED; sessions
 * whose only claims are UNVERIFIABLE should go to REVIEW. Also runs tamper
 * checks (edited payload, foreign key, swapped artifact).
 *
 * Usage: node research/benchmark/run-consumer-gate.mjs --root . --results research/benchmark/results
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).reduce((p, v, i, a) => (v.startsWith("--") && p.push([v.slice(2), a[i + 1]]), p), []));
const ROOT = resolve(args.root ?? ".");
const RESULTS = resolve(args.results ?? "research/benchmark/results");
const record = await import(pathToFileURL(join(ROOT, "dist/modules/verification/application/claim-record.js")).href);
const read = (file) => readFileSync(join(RESULTS, file), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const sessions = read("sessions.jsonl");
const rows = read("rows.jsonl");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
const foreign = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();

function envelopeFor(session, system) {
  let previous = null;
  const traceEvents = session.evidence.map((e, i) => {
    const eventHash = createHash("sha256").update(`${previous}|${JSON.stringify(e)}`).digest("hex");
    const event = { eventId: e.eventId, sequenceNumber: e.sequenceNumber, eventHash, previousEventHash: previous, metadata: i === session.evidence.length - 1 ? { workspaceDigest: session.finalDigest } : {} };
    previous = eventHash;
    return event;
  });
  const claims = rows
    .filter(r => r.system === system && r.session === session.id)
    .map((r, i) => ({ ...r, goldIndex: i }))
    .filter(r => r.predicted !== "MISSED")
    .map(r => ({ claimIndex: r.claimIndex ?? r.goldIndex + 1, claimType: r.predictedType ?? "TASK_COMPLETED",
      claimText: r.claimText ?? session.gold[r.goldIndex]?.quote ?? "", target: r.target ?? "", verdict: r.predicted,
      reasonCode: r.reason ?? "N/A", explanation: r.advisoryRaised ? "Advisory: tests changed" : "",
      evidenceEventIds: r.evidenceEventIds ?? [], verificationRuleVersion: r.policyVersion ?? system.match(/TF ([\d.]+)/u)?.[1] ?? "unknown" }));
  return record.signClaimRecord(record.buildClaimRecord({ session: { promptId: session.id, runId: "r", agentName: "agent", modelName: "m" }, claims, traceEvents }), priv);
}
const expected = (s) => (s.gold.some(g => g.advisory) && s.gold.every(g => g.verdict === "VERIFIED") ? "REVIEW" : s.gold.every((g) => g.verdict === "VERIFIED") ? "ACCEPT" : s.gold.every((g) => g.verdict === "UNVERIFIABLE") ? "REVIEW" : "REJECT");

const systems = [...new Set(rows.map(r => r.system))].filter(s => /^TF .* (?:original|fixed) \(heuristic extraction\)$/u.test(s));
if (systems.length !== 2) throw new Error("Expected original and fixed heuristic systems");
const results = [];
for (const system of ["Trust the report (no gate)", ...systems]) {
  const decisions = sessions.map((s) => {
    const decision = system.startsWith("Trust") ? "ACCEPT" : record.decideOnClaimRecord(envelopeFor(s, system), pub, s.finalDigest).decision;
    return { session: s.id, expected: expected(s), decision };
  });
  const unsafeAccepts = decisions.filter((d) => d.decision === "ACCEPT" && d.expected !== "ACCEPT").length;
  const shouldNotAccept = decisions.filter((d) => d.expected !== "ACCEPT").length;
  const falseRejects = decisions.filter((d) => d.expected === "ACCEPT" && d.decision === "REJECT").length;
  const shouldAccept = decisions.filter((d) => d.expected === "ACCEPT").length;
  results.push({ system, sessions: decisions.length, agreement: decisions.filter((d) => d.decision === d.expected).length / decisions.length, unsafeAcceptRate: unsafeAccepts / shouldNotAccept, falseRejectRate: falseRejects / shouldAccept });
}
// Tamper checks on every session with the fixed system's record.
const tamper = { editedPayload: 0, foreignKey: 0, swappedArtifact: 0, swapAttempts: 0, n: sessions.length };
sessions.forEach((s, i) => {
  const env = envelopeFor(s, systems[1]);
  const statement = JSON.parse(Buffer.from(env.payload, "base64").toString());
  statement.predicate.claims.forEach((c) => (c.verdict = "VERIFIED"));
  statement.predicate.claims.push({ index: 99, type: "TEST_PASSED", text: "x", target: "", verdict: "VERIFIED", reasonCode: "X", advisory: false, evidence: [] });
  if (record.decideOnClaimRecord({ ...env, payload: Buffer.from(JSON.stringify(statement)).toString("base64") }, pub, s.finalDigest).decision === "REJECT") tamper.editedPayload += 1;
  if (record.decideOnClaimRecord(env, foreign, s.finalDigest).decision === "REJECT") tamper.foreignKey += 1;
  // Swap in the first other session whose artifact actually differs.
  const otherDigest = sessions.map((o) => o.finalDigest).find((d) => d !== s.finalDigest);
  if (otherDigest) {
    tamper.swapAttempts += 1;
    if (record.decideOnClaimRecord(env, pub, otherDigest).decision === "REJECT") tamper.swappedArtifact += 1;
  }
});
writeFileSync(join(RESULTS, "consumer-gate.json"), JSON.stringify({ results, tamper }, null, 2));
for (const r of results) console.log(`${r.system}: agreement ${(100 * r.agreement).toFixed(1)}% | unsafe accepts ${(100 * r.unsafeAcceptRate).toFixed(1)}% | false rejects ${(100 * r.falseRejectRate).toFixed(1)}%`);
console.log(`tamper detection over ${tamper.n} sessions: edited payload ${tamper.editedPayload}, foreign key ${tamper.foreignKey}, swapped artifact ${tamper.swappedArtifact}/${tamper.swapAttempts}`);
