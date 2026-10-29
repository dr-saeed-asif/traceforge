import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, type Abi } from "viem";
import {
  createBlockchainClaimAnchorManifest,
  createBlockchainClaimAnchorPayload
} from "@traceforge/claim-anchoring";
import type {
  VerificationClaim,
  VerificationSession,
  VerificationTraceEvent
} from "@traceforge/verification-contracts";
import registryAbi from "@traceforge/claim-anchoring/abi";
import { anchorVerifiedClaim, verifyVerifiedClaimAnchor } from "./blockchain-anchor-client";

afterEach(() => vi.restoreAllMocks());

const abi = registryAbi as Abi;
const recordId = `0x${"ab".repeat(32)}` as const;

const session: VerificationSession = {
  promptId: "prompt-1",
  promptQuery: "Create a test file",
  externalSessionId: "external-session-1",
  runId: "run-1",
  projectName: "TraceForge",
  projectPath: "/workspace/traceforge",
  agentName: "build",
  modelName: "test-model",
  executionStatus: "COMPLETED",
  extractionStatus: "SUCCEEDED",
  verificationStatus: "SUCCEEDED",
  totalClaims: 1,
  verifiedClaims: 1,
  contradictedClaims: 0,
  unsupportedClaims: 0,
  unverifiableClaims: 0,
  scoredClaims: 1,
  reliabilityPercent: 100,
  coveragePercent: 100,
  startedAt: "2026-10-22T10:00:00.000Z",
  completedAt: "2026-10-22T10:01:00.000Z"
};

const claim: VerificationClaim = {
  claimIndex: 1,
  claimText: "Created the test file.",
  claimType: "FILE_CREATED",
  target: "traceforge-test.txt",
  expectedResult: "The file exists.",
  verdict: "VERIFIED",
  reasonCode: "REQUIRED_EVIDENCE_CONFIRMED",
  explanation: "File event confirms creation.",
  evidenceEventIds: ["event-1"],
  extractorModel: "test-model",
  extractionPromptVersion: "1.0.0",
  verificationRuleVersion: "1.0.0",
  verifiedAt: "2026-10-22T10:01:00.000Z"
};

const traceEvents: readonly VerificationTraceEvent[] = [
  {
    id: 1,
    eventId: "event-1",
    sequenceNumber: 1,
    eventType: "FILE_CREATED",
    outcome: "SUCCEEDED",
    occurredAt: "2026-10-22T10:00:30.000Z",
    target: "traceforge-test.txt",
    toolName: "write",
    filePath: "traceforge-test.txt",
    command: null,
    workingDirectory: "/workspace/traceforge",
    exitCode: null,
    testPassed: null,
    testFailed: null,
    testSkipped: null,
    fileExistedBefore: false,
    fileExistsAfter: true,
    fileHashBefore: null,
    fileHashAfter: "c".repeat(64),
    outputHash: null,
    previousEventHash: null,
    eventHash: "d".repeat(64),
    metadata: {}
  }
];

function installProvider(anchor: Record<string, unknown>) {
  const provider = {
    request: vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
      if (method === "eth_chainId") return "0xaa36a7";
      if (method !== "eth_call") throw new Error(`Unexpected RPC method: ${method}`);
      const transaction = params?.[0] as { data: string };
      const selector = transaction.data.slice(0, 10);
      if (selector === "0xff4084a2") {
        return encodeFunctionResult({ abi, functionName: "getRecordId", result: recordId });
      }
      if (selector === "0x7feb51d9") {
        return encodeFunctionResult({
          abi,
          functionName: "getAnchor",
          result: anchor as never
        });
      }
      throw new Error(`Unexpected contract selector: ${selector}`);
    })
  };
  Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
  return provider;
}

describe("verifyVerifiedClaimAnchor", () => {
  it("excludes the wallet approval wait from Sepolia confirmation timing", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const account = "0x1111111111111111111111111111111111111111";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              nonce: `0x${"01".repeat(32)}`,
              deadline: Math.floor(Date.now() / 1000) + 600,
              signature: `0x${"11".repeat(65)}`
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      )
    );
    const provider = {
      request: vi.fn(
        async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
          if (method === "eth_accounts") return [account];
          if (method === "eth_chainId") return "0xaa36a7";
          if (method === "eth_sendTransaction") {
            clock += 60000;
            return `0x${"12".repeat(32)}`;
          }
          if (method === "eth_getTransactionReceipt") {
            clock += 750;
            return { status: "0x1", blockNumber: "0x10" };
          }
          if (method === "eth_call") {
            const { functionName } = decodeFunctionData({
              abi,
              data: (params?.[0] as { data: `0x${string}` }).data
            });
            if (functionName === "owner")
              return encodeFunctionResult({ abi, functionName: "owner", result: account });
            if (functionName === "getRecordId")
              return encodeFunctionResult({ abi, functionName: "getRecordId", result: recordId });
            return encodeFunctionResult({
              abi,
              functionName: "getAnchor",
              result: {
                sessionHash: `0x${"0".repeat(64)}`,
                claimIndex: 0,
                manifestHash: `0x${"0".repeat(64)}`,
                evidenceRoot: `0x${"0".repeat(64)}`,
                schemaVersion: 0,
                anchoredAt: 0n,
                anchoredBy: account,
                verified: false
              } as never
            });
          }
          throw new Error(`Unexpected method ${method}`);
        }
      )
    };
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
    const result = await anchorVerifiedClaim(session, claim, traceEvents);
    expect(result).toMatchObject({ status: "confirmed", confirmationTimeMs: 750 });
  });
  beforeEach(() => {
    Reflect.deleteProperty(window, "ethereum");
  });

  it("confirms when recomputed commitments match the on-chain record", async () => {
    const record = {
      sessionHash: `0x${"0".repeat(64)}`,
      claimIndex: 1,
      manifestHash: `0x${"0".repeat(64)}`,
      evidenceRoot: `0x${"0".repeat(64)}`,
      schemaVersion: 2,
      anchoredAt: 1n,
      anchoredBy: "0x1111111111111111111111111111111111111111",
      verified: true
    };
    const provider = installProvider(record);
    const payload = await createBlockchainClaimAnchorPayload(
      createBlockchainClaimAnchorManifest(session, claim, traceEvents)
    );
    Object.assign(record, {
      sessionHash: payload.sessionHash,
      manifestHash: payload.manifestHash,
      evidenceRoot: payload.evidenceRoot
    });

    const result = await verifyVerifiedClaimAnchor(session, claim, traceEvents);

    expect(result).toMatchObject({
      recordFound: true,
      matches: true,
      recordId,
      anchoredAt: "1",
      anchoredBy: record.anchoredBy,
      mismatches: []
    });
    expect(provider.request).toHaveBeenCalledWith(expect.objectContaining({ method: "eth_call" }));
  });

  it("reports an absent on-chain anchor", async () => {
    installProvider({
      sessionHash: `0x${"0".repeat(64)}`,
      claimIndex: 0,
      manifestHash: `0x${"0".repeat(64)}`,
      evidenceRoot: `0x${"0".repeat(64)}`,
      schemaVersion: 0,
      anchoredAt: 0n,
      anchoredBy: "0x0000000000000000000000000000000000000000",
      verified: false
    });

    const result = await verifyVerifiedClaimAnchor(session, claim, traceEvents);

    expect(result.recordFound).toBe(false);
    expect(result.matches).toBe(false);
    expect(result.mismatches).toContain("No verified on-chain record exists for this claim.");
  });

  it("identifies commitment mismatches", async () => {
    const record = {
      sessionHash: `0x${"0".repeat(64)}`,
      claimIndex: 1,
      manifestHash: `0x${"0".repeat(64)}`,
      evidenceRoot: `0x${"0".repeat(64)}`,
      schemaVersion: 2,
      anchoredAt: 1n,
      anchoredBy: "0x1111111111111111111111111111111111111111",
      verified: true
    };
    installProvider(record);

    const result = await verifyVerifiedClaimAnchor(session, claim, traceEvents);

    expect(result.recordFound).toBe(true);
    expect(result.matches).toBe(false);
    expect(result.mismatches).toEqual([
      "Session hash",
      "Evidence bundle / claim manifest hash",
      "Evidence root"
    ]);
  });
});
