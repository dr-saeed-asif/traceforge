import { describe, expect, it, vi } from "vitest";
import { VerificationApplicationService, type ClaimExtractor, type VerificationEvidence, type VerificationRepository } from "../../../src/modules/verification/index.js";

describe("verification application service", () => {
  it("persists extracted claims, deterministic verdicts, and reliability", async () => {
    const extractor: ClaimExtractor = { extract: vi.fn(async () => [{
      claimIndex: 1,
      claimText: "All tests passed",
      claimType: "TEST_PASSED",
      target: "npm test",
      expectedResult: "exitCode equals 0 and failed equals 0"
    }]) };
    const repository = {
      loadVerificationEvidence: vi.fn(async () => evidence),
      saveExtractedClaim: vi.fn(async () => undefined),
      saveClaimVerification: vi.fn(async () => undefined),
      updateSessionSummary: vi.fn(async () => undefined)
    } as unknown as VerificationRepository;
    const service = new VerificationApplicationService(repository, extractor);
    const evidence: VerificationEvidence[] = [{
      promptId: "prompt-1",
      eventId: "test-event",
      sequenceNumber: 1,
      eventType: "TEST_COMPLETED",
      outcome: "SUCCEEDED",
      occurredAt: "2026-01-01T00:00:00.000Z",
      target: "npm test",
      metadata: { exitCode: 0, passed: 12, failed: 0 }
    }];

    const result = await service.verifyPrompt({
      promptId: "prompt-1",
      externalSessionId: "session-1",
      runId: "run-1",
      finalResponse: "All tests passed",
      extractorModel: "test-model",
      executionStatus: "COMPLETED",
      completedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(result.summary).toMatchObject({ scoredClaims: 1, reliabilityPercent: 100, coveragePercent: 100 });
    expect(repository.loadVerificationEvidence).toHaveBeenCalledWith("prompt-1");
    expect(repository.saveExtractedClaim).toHaveBeenCalledWith(expect.objectContaining({ promptId: "prompt-1", extractionPromptVersion: "1.0.0", verificationRuleVersion: "2.0.0" }));
    expect(repository.saveClaimVerification).toHaveBeenCalledWith(expect.objectContaining({ promptId: "prompt-1", verdict: "VERIFIED", verifiedAt: "2026-01-01T00:00:00.000Z" }));
    expect(repository.updateSessionSummary).toHaveBeenLastCalledWith(expect.objectContaining({
      extractionStatus: "SUCCEEDED",
      verificationStatus: "SUCCEEDED",
      summary: expect.objectContaining({ reliabilityPercent: 100 })
    }));
  });
});
