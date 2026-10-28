import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildClaimRecord,
  decideOnClaimRecord,
  signClaimRecord,
  openClaimRecord,
  type ClaimRecordInput,
} from "../src/modules/verification/application/claim-record.js";
import { computeWorkspaceDigest } from "../src/modules/verification/application/workspace-digest.js";
import { createClaimGateServer } from "../src/mcp-claim-gate.js";
import { snapshotWorkspace, workspaceDigest } from "../packages/adapter-opencode/src/workspace-observer.js";

/** Review R4 Majors 1–2: a verified claim crosses an agent boundary. */
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const DIGEST = "d".repeat(64);

function input(verdicts: readonly ("VERIFIED" | "CONTRADICTED" | "UNSUPPORTED" | "UNVERIFIABLE")[], explanation = ""): ClaimRecordInput {
  return {
    session: { promptId: "p", runId: "r", agentName: "build", modelName: "m" },
    claims: verdicts.map((verdict, i) => ({
      claimIndex: i + 1,
      claimType: "TEST_PASSED",
      claimText: `claim ${i + 1}`,
      target: "npm test",
      verdict,
      reasonCode: verdict === "VERIFIED" ? "REQUIRED_EVIDENCE_CONFIRMED" : "MATCHING_EVIDENCE_NOT_FOUND",
      explanation,
      evidenceEventIds: ["e1"],
      verificationRuleVersion: "2.1.0",
    })),
    traceEvents: [
      { eventId: "e1", sequenceNumber: 1, eventHash: "a".repeat(64), previousEventHash: null, metadata: {} },
      { eventId: "e2", sequenceNumber: 2, eventHash: "b".repeat(64), previousEventHash: "a".repeat(64), metadata: { workspaceDigest: DIGEST } },
    ],
  };
}

describe("claim records", () => {
  it("accepts a correctly signed record for the received artifact", () => {
    const envelope = signClaimRecord(buildClaimRecord(input(["VERIFIED"])), privatePem);
    expect(decideOnClaimRecord(envelope, publicPem, DIGEST).decision).toBe("ACCEPT");
  });
  it("rejects contradicted or unsupported claims, and flags advisories for review", () => {
    expect(decideOnClaimRecord(signClaimRecord(buildClaimRecord(input(["VERIFIED", "CONTRADICTED"])), privatePem), publicPem, DIGEST).decision).toBe("REJECT");
    expect(decideOnClaimRecord(signClaimRecord(buildClaimRecord(input(["UNSUPPORTED"])), privatePem), publicPem, DIGEST).decision).toBe("REJECT");
    expect(decideOnClaimRecord(signClaimRecord(buildClaimRecord(input(["VERIFIED"], "ok. Advisory: tests changed")), privatePem), publicPem, DIGEST).decision).toBe("REVIEW");
  });
  it("rejects tampered payloads, foreign keys and a different artifact", () => {
    const envelope = signClaimRecord(buildClaimRecord(input(["CONTRADICTED"])), privatePem);
    const forged = Buffer.from(Buffer.from(envelope.payload, "base64").toString().replace("CONTRADICTED", "VERIFIED")).toString("base64");
    expect(decideOnClaimRecord({ ...envelope, payload: forged }, publicPem, DIGEST).reasons[0]).toMatch(/Signature/);
    expect(decideOnClaimRecord(envelope, other, DIGEST).reasons[0]).toMatch(/Signature/);
    const ok = signClaimRecord(buildClaimRecord(input(["VERIFIED"])), privatePem);
    expect(decideOnClaimRecord(ok, publicPem, "e".repeat(64)).reasons[0]).toMatch(/different artifact/);
  });
  it("rejects malformed signed records without throwing and binds empty records to the artifact", () => {
    const valid = buildClaimRecord(input(["VERIFIED"]));
    const malformed = { ...valid, predicate: { ...valid.predicate, claims: [{ ...valid.predicate.claims[0]!, verdict: "UNKNOWN" }] } };
    expect(decideOnClaimRecord(signClaimRecord(malformed as unknown as typeof valid, privatePem), publicPem, DIGEST).decision).toBe("REJECT");
    const mismatched = { ...valid, predicate: { ...valid.predicate, verdictCounts: { ...valid.predicate.verdictCounts, VERIFIED: 99 } } };
    expect(openClaimRecord(signClaimRecord(mismatched, privatePem), publicPem)).toBeNull();
    expect(openClaimRecord({ payloadType: "bad", payload: "", signatures: [] }, "invalid key")).toBeNull();
    expect(decideOnClaimRecord(signClaimRecord(buildClaimRecord(input([])), privatePem), publicPem, "e".repeat(64)).decision).toBe("REJECT");
  });
  it("refuses an incomplete workspace observation", () => {
    const source = input(["VERIFIED"]);
    expect(() => buildClaimRecord({ ...source, traceEvents: source.traceEvents.map(e => ({ ...e, metadata: { ...e.metadata, workspaceObservation: "incomplete" } })) })).toThrow(/workspace digest/);
  });
  it("refuses to build a record without an artifact digest or with a broken chain", () => {
    const noDigest = input(["VERIFIED"]);
    expect(() => buildClaimRecord({ ...noDigest, traceEvents: noDigest.traceEvents.map((e) => ({ ...e, metadata: {} })) })).toThrow(/workspace digest/);
    expect(() => buildClaimRecord({ ...noDigest, traceEvents: [noDigest.traceEvents[0]!, { ...noDigest.traceEvents[1]!, previousEventHash: "x" }] })).toThrow(/chain/);
  });
});

describe("consumer workspace digest", () => {
  let dir = "";
  afterEach(async () => dir && rm(dir, { recursive: true, force: true }));
  it("matches the capture layer's digest", async () => {
    dir = await mkdtemp(join(tmpdir(), "tf-digest-"));
    await writeFile(join(dir, "a.ts"), "a");
    await writeFile(join(dir, ".env"), "SECRET=1");
    expect(await computeWorkspaceDigest(dir)).toBe(workspaceDigest(await snapshotWorkspace(dir)));
  });
});

describe("MCP claim gate", () => {
  it("lets a second agent fetch a record and get a decision over MCP", async () => {
    const envelope = signClaimRecord(buildClaimRecord(input(["VERIFIED"])), privatePem);
    const server = createClaimGateServer({ fetchRecord: async () => envelope, publicKeyPem: async () => publicPem });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "reviewer-agent", version: "1.0.0" });
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["traceforge_check_claim_record", "traceforge_get_claim_record", "traceforge_workspace_digest"]);
    const fetched = JSON.parse((await client.callTool({ name: "traceforge_get_claim_record", arguments: { promptId: "p" } })).content[0].text);
    const decision = JSON.parse(
      (await client.callTool({ name: "traceforge_check_claim_record", arguments: { envelope: fetched, artifactDigest: DIGEST } })).content[0].text,
    );
    expect(decision.decision).toBe("ACCEPT");
    await client.close();
  });
});
