import { describe, expect, it, vi } from "vitest";
import {
  VerificationQueryService,
  type VerificationRepository,
  type VerificationSessionDetails,
  type VerificationSessionSummaryRecord
} from "../../../src/modules/verification/index.js";

const session: VerificationSessionSummaryRecord = {
  promptId: "prompt-1",
  promptQuery: "Create the requested file",
  externalSessionId: "session-1",
  runId: "run-1",
  projectName: "TraceForge",
  projectPath: "H:/TraceForge",
  agentName: "builder",
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
  startedAt: "2026-09-20T10:00:00.000Z",
  completedAt: "2026-09-20T10:00:10.000Z"
};

describe("verification query service", () => {
  it("normalizes pagination and returns overview plus the same read-model sessions", async () => {
    const repository = {
      getOverview: vi.fn(async () => ({
        totalSessions: 1,
        totalClaims: 1,
        verifiedClaims: 1,
        contradictedClaims: 0,
        unsupportedClaims: 0,
        unverifiableClaims: 0,
        scoredClaims: 1,
        reliabilityPercent: 100,
        coveragePercent: 100
      })),
      listSessions: vi.fn(async () => [session])
    } as unknown as VerificationRepository;

    const result = await new VerificationQueryService(repository).getOverview({
      limit: 10,
      offset: 20,
      startedAfter: "2026-09-01T00:00:00.000Z"
    });

    expect(result.pagination).toEqual({ limit: 10, offset: 20, returned: 1 });
    expect(result.sessions).toEqual([session]);
    expect(repository.getOverview).toHaveBeenCalledWith({ startedAfter: "2026-09-01T00:00:00.000Z" });
    expect(repository.listSessions).toHaveBeenCalledWith({
      startedAfter: "2026-09-01T00:00:00.000Z",
      limit: 10,
      offset: 20
    });
  });

  it("copies nested detail arrays so callers cannot mutate the repository read model", async () => {
    const details: VerificationSessionDetails = {
      session,
      claims: [{
        claimIndex: 1,
        claimText: "The file was created",
        claimType: "FILE_CREATED",
        target: "src/app.ts",
        expectedResult: "file exists",
        verdict: "VERIFIED",
        reasonCode: "REQUIRED_EVIDENCE_CONFIRMED",
        explanation: "A successful creation event was recorded.",
        evidenceEventIds: ["event-1"],
        extractorModel: "test-model",
        extractionPromptVersion: "1.0.0",
        verificationRuleVersion: "1.0.0",
        verifiedAt: "2026-09-20T10:00:10.000Z"
      }],
      traceEvents: [{
        id: 1,
        eventId: "event-1",
        sequenceNumber: 1,
        eventType: "FILE_CREATED",
        outcome: "SUCCEEDED",
        occurredAt: "2026-09-20T10:00:01.000Z",
        target: "src/app.ts",
        toolName: "write",
        filePath: "src/app.ts",
        command: null,
        workingDirectory: null,
        exitCode: null,
        testPassed: null,
        testFailed: null,
        testSkipped: null,
        fileExistedBefore: false,
        fileExistsAfter: true,
        fileHashBefore: null,
        fileHashAfter: "b".repeat(64),
        outputHash: null,
        previousEventHash: null,
        eventHash: "c".repeat(64),
        metadata: { filePath: "src/app.ts" }
      }]
    };
    const repository = { getSessionDetails: vi.fn(async () => details) } as unknown as VerificationRepository;

    const result = await new VerificationQueryService(repository).getSessionDetails(" prompt-1 ");
    expect(result).not.toBeNull();
    expect(result?.claims).not.toBe(details.claims);
    expect(result?.traceEvents).not.toBe(details.traceEvents);
    expect(repository.getSessionDetails).toHaveBeenCalledWith("prompt-1");
  });

  it("returns ten session rows and reports whether another page exists", async () => {
    const sessions = Array.from({ length: 11 }, (_, index) => ({
      ...session,
      promptId: `prompt-${index + 1}`
    }));
    const repository = {
      listSessions: vi.fn(async () => sessions)
    } as unknown as VerificationRepository;

    const result = await new VerificationQueryService(repository).getSessions({ limit: 10, offset: 20 });

    expect(result.sessions).toHaveLength(10);
    expect(result.pagination).toEqual({ limit: 10, offset: 20, returned: 10, hasMore: true });
    expect(repository.listSessions).toHaveBeenCalledWith({ limit: 11, offset: 20 });
  });

  it("rejects unsafe page sizes and empty prompt identifiers", async () => {
    const service = new VerificationQueryService({} as VerificationRepository);
    await expect(service.getSessions({ limit: 101 })).rejects.toThrow("limit must be an integer");
    await expect(service.getSessionDetails("   ")).rejects.toThrow("promptId must be a non-empty identifier");
  });
});
