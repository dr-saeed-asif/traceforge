#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs, readJsonl, toCsv } from "./lib.mjs";

const CLAIM_TYPES = new Set([
  "FILE_CREATED",
  "FILE_MODIFIED",
  "STRUCTURE_CREATED",
  "DEPENDENCY_RULE",
  "COMMAND_SUCCEEDED",
  "BUILD_PASSED",
  "TEST_PASSED",
  "TASK_COMPLETED",
]);
const VERDICTS = new Set(["VERIFIED", "CONTRADICTED", "UNSUPPORTED", "UNVERIFIABLE"]);
const EXPECTED_RESULTS = {
  FILE_CREATED: "target exists after the change",
  FILE_MODIFIED: "target changed to the claimed implementation",
  STRUCTURE_CREATED: "claimed structure exists",
  DEPENDENCY_RULE: "dependency rule passes without forbidden imports",
  COMMAND_SUCCEEDED: "matching command exits with code 0",
  BUILD_PASSED: "exitCode equals 0",
  TEST_PASSED: "exitCode equals 0 and failed equals 0",
  TASK_COMPLETED: "all required objective claims are verified",
};

const args = parseArgs(process.argv.slice(2));
const root = resolve(import.meta.dirname, "../..");
const sessionsPath = resolve(args.sessions ?? resolve(root, "research/benchmark/results/sessions.jsonl"));
const summaryPath = resolve(args.summary ?? resolve(root, "research/benchmark/results/summary.json"));
const rowsPath = resolve(args.rows ?? resolve(root, "research/benchmark/results/rows.jsonl"));
const outputPath = resolve(args.output ?? resolve(root, "research/datasets/controlled-v1.jsonl"));
const exportDirectory = resolve(args["export-dir"] ?? resolve(root, "research/exports/controlled-v1"));
const force = args.force === true;

function sentenceSpan(response, quote) {
  const start = response.indexOf(quote);
  if (start < 0) return null;
  if (/[.!?]$/u.test(quote)) return quote;
  const remainder = response.slice(start + quote.length);
  const terminator = remainder.match(/^[^.!?]*[.!?]/u);
  const end = start + quote.length + (terminator ? terminator[0].length : 0);
  return response.slice(start, end).trim();
}

for (const path of [sessionsPath, summaryPath, rowsPath]) {
  if (!existsSync(path)) throw new Error(`Missing controlled benchmark artifact: ${path}`);
}
if (!force && existsSync(outputPath)) throw new Error(`Refusing to overwrite ${outputPath}; use --force after review.`);
if (!force && existsSync(exportDirectory)) throw new Error(`Refusing to overwrite export directory ${exportDirectory}; use --force after review.`);

const sessions = readJsonl(sessionsPath);
const ids = new Set();
const cases = [];
let claimCount = 0;
for (const session of sessions) {
  if (typeof session.id !== "string" || !session.id || ids.has(session.id)) {
    throw new Error("Controlled sessions need unique string ids.");
  }
  ids.add(session.id);
  if (typeof session.response !== "string" || !Array.isArray(session.evidence) || !Array.isArray(session.gold)) {
    throw new Error(`${session.id}: missing response, evidence, or gold labels.`);
  }
  if (new Set(session.evidence.map((event) => event.promptId)).size > 1) {
    throw new Error(`${session.id}: evidence spans more than one promptId.`);
  }
  const goldClaims = session.gold.map((gold, index) => {
    if (typeof gold.quote !== "string" || !session.response.includes(gold.quote)) {
      throw new Error(`${session.id}: gold claim ${index + 1} is not an exact response substring.`);
    }
    if (!CLAIM_TYPES.has(gold.claimType)) throw new Error(`${session.id}: invalid claim type ${gold.claimType}.`);
    if (!VERDICTS.has(gold.verdict)) throw new Error(`${session.id}: invalid verdict ${gold.verdict}.`);
    if (typeof gold.target !== "string" || !gold.target) throw new Error(`${session.id}: missing target.`);
    const quote = sentenceSpan(session.response, gold.quote);
    if (!quote || !session.response.includes(quote)) {
      throw new Error(`${session.id}: could not derive an exact sentence span for gold claim ${index + 1}.`);
    }
    return {
      claimIndex: index + 1,
      claimText: quote,
      sourceQuote: quote,
      benchmarkQuote: gold.quote,
      claimType: gold.claimType,
      target: gold.target,
      expectedResult: EXPECTED_RESULTS[gold.claimType],
      verdict: gold.verdict,
      testTampering: gold.advisory === true,
      captureCompleteness: "COMPLETE",
      evidenceEventIds: gold.evidence
        ? session.evidence.filter((event) => event.target === gold.evidence).map((event) => event.eventId)
        : [],
    };
  });
  claimCount += goldClaims.length;
  cases.push({
    id: session.id,
    promptQuery: "",
    finalResponse: session.response,
    evidence: session.evidence,
    goldClaims,
    annotationStatus: "controlled",
    metadata: {
      family: session.family,
      finalDigest: session.finalDigest,
      promptAvailable: false,
      collectionMetadata: { taskId: session.family },
      labelProvenance:
        "Controlled benchmark: scenario actions were executed for real; labels are known by construction. These are not human-adjudicated natural sessions.",
      sourceArtifact: "research/benchmark/results/sessions.jsonl",
    },
  });
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, cases.map((item) => JSON.stringify(item)).join("\n") + "\n", {
  encoding: "utf8",
  flag: force ? "w" : "wx",
});

mkdirSync(exportDirectory, { recursive: true });
const sessionRows = [
  ["session_id", "family", "prompt", "final_response", "evidence_count", "gold_claim_count", "final_digest", "label_provenance"],
];
const claimRows = [
  ["session_id", "family", "claim_index", "source_quote", "claim_type", "target", "expected_result", "gold_verdict", "test_tampering", "capture_completeness", "evidence_event_ids"],
];
const evidenceRows = [
  ["session_id", "family", "event_id", "sequence_number", "event_type", "outcome", "occurred_at", "target", "metadata_json"],
];
for (const item of cases) {
  sessionRows.push([
    item.id,
    item.metadata.family,
    item.promptQuery,
    item.finalResponse,
    item.evidence.length,
    item.goldClaims.length,
    item.metadata.finalDigest,
    item.metadata.labelProvenance,
  ]);
  for (const claim of item.goldClaims) {
    claimRows.push([
      item.id,
      item.metadata.family,
      claim.claimIndex,
      claim.sourceQuote,
      claim.claimType,
      claim.target,
      claim.expectedResult,
      claim.verdict,
      claim.testTampering,
      claim.captureCompleteness,
      JSON.stringify(claim.evidenceEventIds),
    ]);
  }
  for (const event of item.evidence) {
    evidenceRows.push([
      item.id,
      item.metadata.family,
      event.eventId,
      event.sequenceNumber,
      event.eventType,
      event.outcome,
      event.occurredAt,
      event.target ?? "",
      JSON.stringify(event.metadata ?? {}),
    ]);
  }
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const summaryRows = [
  ["stage", "system", "n", "accuracy", "macro_f1", "false_verified_rate", "false_contradicted_rate", "missed_claim_rate", "wrong_evidence_rate", "advisory_recall", "accuracy_ci_lower", "accuracy_ci_upper", "false_verified_ci_lower", "false_verified_ci_upper"],
];
for (const [stage, entries] of [
  ["main", summary.summary ?? []],
  ["held-out", summary.heldOutSummary ?? []],
]) {
  for (const row of entries) {
    summaryRows.push([
      stage,
      row.system,
      row.n,
      row.accuracy,
      row.macroF1,
      row.falseVerifiedRate,
      row.falseContradictedRate,
      row.missedClaimRate,
      row.wrongEvidenceRate,
      row.advisoryRecall,
      row.accuracyCI?.[0] ?? "",
      row.accuracyCI?.[1] ?? "",
      row.falseVerifiedCI?.[0] ?? "",
      row.falseVerifiedCI?.[1] ?? "",
    ]);
  }
}
const familyRows = [
  ["family", "gold_verdict", "systems"],
];
for (const family of summary.families ?? []) {
  const systems = Object.fromEntries(Object.entries(family).filter(([key]) => !["family", "gold"].includes(key)));
  familyRows.push([family.family, family.gold, JSON.stringify(systems)]);
}

const rowRecords = readJsonl(rowsPath);
const perClaimRows = [
  ["system", "session_id", "family", "gold_verdict", "predicted_verdict", "predicted_claim_type", "correct", "reason", "wrong_evidence", "advisory_expected", "advisory_raised"],
];
for (const row of rowRecords) {
  perClaimRows.push([
    row.system,
    row.session,
    row.family,
    row.gold,
    row.predicted,
    row.predictedType ?? "",
    row.gold === row.predicted,
    row.reason ?? "",
    row.wrongEvidence ?? "",
    row.advisoryExpected ?? "",
    row.advisoryRaised ?? "",
  ]);
}

const files = {
  "sessions.csv": sessionRows,
  "gold-claims.csv": claimRows,
  "evidence.csv": evidenceRows,
  "benchmark-summary.csv": summaryRows,
  "benchmark-families.csv": familyRows,
  "benchmark-per-claim.csv": perClaimRows,
};
for (const [name, rows] of Object.entries(files)) {
  writeFileSync(resolve(exportDirectory, name), toCsv(rows), { encoding: "utf8", flag: force ? "w" : "wx" });
}

console.log(
  JSON.stringify(
    {
      dataset: outputPath,
      exportDirectory,
      sessions: cases.length,
      claims: claimCount,
      evidence: cases.reduce((sum, item) => sum + item.evidence.length, 0),
      benchmarkRows: rowRecords.length,
      reviewDataMultiple: Math.round((cases.length / 40) * 100) / 100,
      note: "Controlled labels are known by construction, not human-adjudicated natural labels.",
    },
    null,
    2,
  ),
);
