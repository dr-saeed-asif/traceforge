import type {
  ExtractedClaim,
  VerificationEvidence,
} from "../domain/contracts.js";
import { CLAIM_VERIFICATION_POLICY_VERSION } from "../domain/claim-verification-policy.js";
import {
  calculateReliabilitySummary,
  type ReliabilitySummary,
} from "../domain/reliability.js";
import type { ExecutionStatus, ProcessingStatus } from "../domain/statuses.js";
import type { VerificationRepository } from "./ports/verification-repository.js";
import {
  EXTRACTION_PROMPT_VERSION,
  HeuristicClaimExtractor,
  type ClaimExtractor,
} from "./claim-extractor.js";
import { verifyClaims } from "./claim-verifier.js";
import type { ClaimVerificationResult } from "../domain/contracts.js";
import type { ProcessingMetrics } from "../domain/processing-metrics.js";

export interface VerifyPromptInput {
  readonly promptId: string;
  readonly externalSessionId: string;
  readonly runId: string;
  readonly finalResponse: string;
  readonly extractorModel: string;
  readonly executionStatus: ExecutionStatus;
  readonly completedAt: string | null;
  /** @deprecated Evidence is always reloaded from durable prompt-scoped storage. */
  readonly evidence?: readonly VerificationEvidence[];
}

export interface VerifyPromptResult {
  readonly claims: readonly ExtractedClaim[];
  readonly verifications: readonly ClaimVerificationResult[];
  readonly summary: ReliabilitySummary;
}

/**
 * Coordinates extraction, deterministic verification, persistence, and the
 * derived reliability summary for one completed prompt.
 */
export class VerificationApplicationService {
  public constructor(
    private readonly repository: VerificationRepository,
    private readonly extractor: ClaimExtractor = new HeuristicClaimExtractor(),
  ) {}

  public async verifyPrompt(
    input: VerifyPromptInput,
  ): Promise<VerifyPromptResult> {
    let claims: readonly ExtractedClaim[] = [];
    let extractionComplete = false;
    const extractionStart = performance.now();
    let verificationStart: number | undefined;
    let metrics: ProcessingMetrics = {
      extractorModel: this.extractor.modelName ?? input.extractorModel,
      extractionStartedAt: new Date().toISOString(),
      extractionCompletedAt: null,
      extractionDurationMs: null,
      extractorDurationMs: null,
      verificationStartedAt: null,
      verificationCompletedAt: null,
      verificationDurationMs: null,
    };
    try {
      // Publish completion before awaiting the potentially slow local model.
      await this.updateStatus(
        input,
        "PENDING",
        "NOT_STARTED",
        calculateReliabilitySummary([]),
        metrics,
      );
      const extractorStart = performance.now();
      // Review fix T4: record which extraction path produced the claims
      // (model output, or the exact-quote heuristic fallback).
      let extractionPath = "primary";
      try {
        const request = { finalResponse: input.finalResponse, modelName: input.extractorModel };
        if (this.extractor.extractDetailed) {
          const detailed = await this.extractor.extractDetailed(request);
          claims = detailed.claims;
          metrics = { ...metrics, extractionMetadata: detailed.metadata };
          if (typeof detailed.metadata.fallback === "string") extractionPath = `fallback:${detailed.metadata.fallback}`;
        } else {
          claims = await this.extractor.extract(request);
          metrics = { ...metrics, extractionMetadata: { provider: "heuristic", model: this.extractor.modelName ?? input.extractorModel, attemptCount: 0, repairCount: 0, fallback: null, outcome: claims.length ? "SUCCEEDED" : "SUCCESSFUL_EMPTY" } };
        }
      } catch (error) {
        const metadata = error && typeof error === "object" && "extractionMetadata" in error ? error.extractionMetadata : null;
        if (metadata && typeof metadata === "object") metrics = { ...metrics, extractionMetadata: metadata as Readonly<Record<string, unknown>> };
        throw error;
      } finally {
        metrics = {
          ...metrics,
          extractorDurationMs: Math.round(performance.now() - extractorStart),
        };
      }
      const baseModel = this.extractor.modelName ?? input.extractorModel;
      const extractorModel =
        extractionPath === "primary" ? baseModel : `${baseModel}+${extractionPath}`;
      for (const claim of claims) {
        await this.repository.saveExtractedClaim({
          ...claim,
          promptId: input.promptId,
          extractorModel,
          extractionPromptVersion: EXTRACTION_PROMPT_VERSION,
          verificationRuleVersion: CLAIM_VERIFICATION_POLICY_VERSION,
        });
      }
      extractionComplete = true;
      metrics = {
        ...metrics,
        extractionCompletedAt: new Date().toISOString(),
        extractionDurationMs: Math.round(performance.now() - extractionStart),
        verificationStartedAt: new Date().toISOString(),
      };
      verificationStart = performance.now();
      await this.updateStatus(
        input,
        "SUCCEEDED",
        "PENDING",
        calculateReliabilitySummary([]),
        metrics,
      );
      // Evidence is loaded by prompt_id from durable storage. Callers cannot
      // accidentally pass events from another prompt/session into a verdict.
      const evidence = await this.repository.loadVerificationEvidence(
        input.promptId,
      );
      const verifications = verifyClaims(claims, evidence, {
        promptId: input.promptId,
        ruleVersion: CLAIM_VERIFICATION_POLICY_VERSION,
      });
      for (const verification of verifications) {
        await this.repository.saveClaimVerification({
          ...verification,
          promptId: input.promptId,
          verifiedAt: input.completedAt ?? new Date().toISOString(),
        });
      }
      const summary = calculateReliabilitySummary(
        verifications.map((value) => value.verdict),
      );
      metrics = {
        ...metrics,
        verificationCompletedAt: new Date().toISOString(),
        verificationDurationMs: Math.round(
          performance.now() - verificationStart,
        ),
      };
      await this.updateStatus(
        input,
        "SUCCEEDED",
        "SUCCEEDED",
        summary,
        metrics,
      );
      return { claims, verifications, summary };
    } catch (error) {
      metrics = extractionComplete
        ? {
            ...metrics,
            verificationCompletedAt: new Date().toISOString(),
            verificationDurationMs: Math.round(
              performance.now() - verificationStart!,
            ),
          }
        : {
            ...metrics,
            extractionCompletedAt: new Date().toISOString(),
            extractionDurationMs: Math.round(
              performance.now() - extractionStart,
            ),
          };
      await this.updateStatus(
        input,
        extractionComplete ? "SUCCEEDED" : "FAILED",
        extractionComplete ? "FAILED" : "NOT_STARTED",
        calculateReliabilitySummary([]),
        metrics,
      ).catch(() => undefined);
      throw error;
    }
  }

  private updateStatus(
    input: VerifyPromptInput,
    extractionStatus: ProcessingStatus,
    verificationStatus: ProcessingStatus,
    summary: ReliabilitySummary,
    processingMetrics: ProcessingMetrics,
  ): Promise<void> {
    return this.repository.updateSessionSummary({
      promptId: input.promptId,
      executionStatus: input.executionStatus,
      extractionStatus,
      verificationStatus,
      summary,
      completedAt: input.completedAt,
      processingMetrics,
    });
  }
}
