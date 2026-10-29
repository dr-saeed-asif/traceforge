import { describe, expect, it } from "vitest";
import {
  createBlockchainClaimAnchorManifest,
  createBlockchainClaimAnchorPayload,
} from "../packages/claim-anchoring/src/blockchain-anchor.js";
import type {
  VerificationClaim,
  VerificationSession,
  VerificationTraceEvent,
} from "@traceforge/verification-contracts";

/** Review fixes T9/T10: schema-2 manifests commit to the whole trace and session outcome. */
function event(sequenceNumber: number, previous: string | null, hash: string, metadata = {}): VerificationTraceEvent {
  return {
    id: sequenceNumber,
    eventId: `e${sequenceNumber}`,
    sequenceNumber,
    eventType: "TEST_COMPLETED",
    outcome: "SUCCEEDED",
    occurredAt: "2026-10-23T10:00:00.000Z",
    target: "npm test",
    toolName: "bash",
    filePath: null,
    command: "npm test",
    workingDirectory: ".",
    exitCode: 0,
    testPassed: 1,
    testFailed: 0,
    testSkipped: 0,
    fileExistedBefore: null,
    fileExistsAfter: null,
    fileHashBefore: null,
    fileHashAfter: null,
    outputHash: null,
    previousEventHash: previous,
    eventHash: hash,
    metadata,
  };
}

const session = {
  promptId: "p",
  runId: "r",
  agentName: "build",
  modelName: "model-x",
  totalClaims: 3,
  verifiedClaims: 1,
  contradictedClaims: 2,
  unsupportedClaims: 0,
  unverifiableClaims: 0,
} as unknown as VerificationSession;

const claim = {
  claimIndex: 1,
  claimText: "Tests passed",
  claimType: "TEST_PASSED",
  target: "npm test",
  expectedResult: "exitCode equals 0",
  verdict: "VERIFIED",
  evidenceEventIds: ["e1"],
  verificationRuleVersion: "2.1.0",
  verifiedAt: "2026-10-23T10:01:00.000Z",
} as unknown as VerificationClaim;

const trace = [
  event(1, null, "a".repeat(64)),
  event(2, "a".repeat(64), "b".repeat(64), { workspaceDigest: "d".repeat(64) }),
];

describe("schema-2 claim manifests", () => {
  it("commits to the chain head, full verdict counts, workspace digest and agent", () => {
    const manifest = createBlockchainClaimAnchorManifest(session, claim, trace);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.traceHead).toEqual({ eventId: "e2", sequenceNumber: 2, eventHash: "b".repeat(64), eventCount: 2 });
    expect(manifest.sessionVerdicts).toMatchObject({ verified: 1, contradicted: 2 });
    expect(manifest.workspaceDigest).toBe("d".repeat(64));
    expect(manifest.agent).toEqual({ agentName: "build", modelName: "model-x" });
  });

  it("changes the manifest digest when an unreferenced event is removed", async () => {
    const full = await createBlockchainClaimAnchorPayload(createBlockchainClaimAnchorManifest(session, claim, trace));
    const truncated = await createBlockchainClaimAnchorPayload(
      createBlockchainClaimAnchorManifest(session, claim, trace.slice(0, 1)),
    );
    expect(truncated.evidenceRoot).toBe(full.evidenceRoot);
    expect(truncated.manifestHash).not.toBe(full.manifestHash);
  });

  it("rejects a broken hash chain", () => {
    const broken = [trace[0]!, { ...trace[1]!, previousEventHash: "f".repeat(64) }];
    expect(() => createBlockchainClaimAnchorManifest(session, claim, broken)).toThrow(/hash chain is broken/);
  });

  it("rejects a trace whose prefix or sequence was removed", () => {
    expect(() => createBlockchainClaimAnchorManifest(session, { ...claim, evidenceEventIds: [] }, trace.slice(1))).toThrow(/chain/);
    expect(() => createBlockchainClaimAnchorManifest(session, claim, [trace[0]!, { ...trace[1]!, sequenceNumber: 3 }])).toThrow(/chain/);
  });

  it("still produces schema-1 manifests for legacy records", () => {
    const legacy = createBlockchainClaimAnchorManifest(session, claim, trace, 1);
    expect(legacy.schemaVersion).toBe(1);
    expect(legacy.traceHead).toBeUndefined();
  });
});
