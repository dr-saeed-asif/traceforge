import { describe, expect, it, vi } from "vitest";
import {
  VerificationApplicationService,
  type ClaimExtractor,
  type VerificationEvidence,
  type VerificationRepository,
} from "../../../src/modules/verification/index.js";

describe("verification application service", () => {
  it("publishes execution completion while extraction is waiting and records the actual extractor", async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const repository = {
      loadVerificationEvidence: vi.fn(async () => []),
      saveExtractedClaim: vi.fn(async () => undefined),
      saveClaimVerification: vi.fn(async () => undefined),
      updateSessionSummary: vi.fn(async () => undefined),
    } as unknown as VerificationRepository;
    const service = new VerificationApplicationService(repository, {
      modelName: "local-extractor",
      extract: async () => { await waiting; return []; },
    });
    const result = service.verifyPrompt({ promptId: "p", externalSessionId: "s", runId: "r",
      finalResponse: "Done", extractorModel: "coding-agent-model", executionStatus: "COMPLETED",
      completedAt: new Date().toISOString() });
    await Promise.resolve();
    expect(repository.updateSessionSummary).toHaveBeenLastCalledWith(expect.objectContaining({
      executionStatus: "COMPLETED", extractionStatus: "PENDING", verificationStatus: "NOT_STARTED",
      processingMetrics: expect.objectContaining({ extractorModel: "local-extractor", extractionDurationMs: null }),
    }));
    release();
    await result;
    expect(repository.updateSessionSummary).toHaveBeenLastCalledWith(expect.objectContaining({
      extractionStatus: "SUCCEEDED", verificationStatus: "SUCCEEDED",
      processingMetrics: expect.objectContaining({ extractionDurationMs: expect.any(Number), verificationDurationMs: expect.any(Number) }),
    }));
  });

  it("preserves extraction timing on a model failure", async () => {
    const repository = { updateSessionSummary: vi.fn(async () => undefined) } as unknown as VerificationRepository;
    const service = new VerificationApplicationService(repository, {
      modelName: "failed-model", extract: async () => { throw new Error("timeout"); },
    });
    await expect(service.verifyPrompt({ promptId: "p", externalSessionId: "s", runId: "r",
      finalResponse: "Done", extractorModel: "agent", executionStatus: "COMPLETED", completedAt: new Date().toISOString(),
    })).rejects.toThrow("timeout");
    expect(repository.updateSessionSummary).toHaveBeenLastCalledWith(expect.objectContaining({
      extractionStatus: "FAILED", verificationStatus: "NOT_STARTED",
      processingMetrics: expect.objectContaining({ extractorModel: "failed-model", extractionDurationMs: expect.any(Number), verificationDurationMs: null }),
    }));
  });

  it("persists extracted claims, deterministic verdicts, and reliability", async () => {
    const extractor: ClaimExtractor = {
      extract: vi.fn(async () => [
        {
          claimIndex: 1,
          claimText: "All tests passed",
          claimType: "TEST_PASSED",
          target: "npm test",
          expectedResult: "exitCode equals 0 and failed equals 0",
        },
      ]),
    };
    const repository = {
      loadVerificationEvidence: vi.fn(async () => evidence),
      saveExtractedClaim: vi.fn(async () => undefined),
      saveClaimVerification: vi.fn(async () => undefined),
      updateSessionSummary: vi.fn(async () => undefined),
    } as unknown as VerificationRepository;
    const service = new VerificationApplicationService(repository, extractor);
    const evidence: VerificationEvidence[] = [
      {
        promptId: "prompt-1",
        eventId: "test-event",
        sequenceNumber: 1,
        eventType: "TEST_COMPLETED",
        outcome: "SUCCEEDED",
        occurredAt: "2026-01-01T00:00:00.000Z",
        target: "npm test",
        metadata: { exitCode: 0, passed: 12, failed: 0 },
      },
    ];

    const result = await service.verifyPrompt({
      promptId: "prompt-1",
      externalSessionId: "session-1",
      runId: "run-1",
      finalResponse: "All tests passed",
      extractorModel: "test-model",
      executionStatus: "COMPLETED",
      completedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result.summary).toMatchObject({
      scoredClaims: 1,
      reliabilityPercent: 100,
      coveragePercent: 100,
    });
    expect(repository.loadVerificationEvidence).toHaveBeenCalledWith(
      "prompt-1",
    );
    expect(repository.saveExtractedClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "prompt-1",
        extractionPromptVersion: "3.0.0",
        verificationRuleVersion: "2.0.0",
      }),
    );
    expect(repository.saveClaimVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "prompt-1",
        verdict: "VERIFIED",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(repository.updateSessionSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        extractionStatus: "SUCCEEDED",
        verificationStatus: "SUCCEEDED",
        summary: expect.objectContaining({ reliabilityPercent: 100 }),
      }),
    );
  });
});
