import type { ClaimType } from "./claim-types.js";
import type { ProcessingStatus, ExecutionStatus } from "./statuses.js";
import type { TraceEventOutcome, TraceEventType } from "./trace-event-types.js";
import type { VerificationVerdict, VerdictReasonCode } from "./verdicts.js";

/**
 * Identity shared by all records belonging to one user prompt.
 *
 * promptId is the canonical query boundary. externalSessionId may contain
 * several prompts and therefore must never be used as the unique query key.
 */
export interface VerificationSessionIdentity {
  readonly promptId: string;
  readonly externalSessionId: string;
  readonly runId: string;
}

/** Summary state owned by the future ExecutionSession persistence model. */
export interface VerificationSession extends VerificationSessionIdentity {
  readonly executionStatus: ExecutionStatus;
  readonly extractionStatus: ProcessingStatus;
  readonly verificationStatus: ProcessingStatus;
}

/** Structured, independently verifiable statement extracted from a response. */
export interface ExtractedClaim {
  /** One-based position in the final response, stable within the prompt. */
  readonly claimIndex: number;
  readonly claimText: string;
  readonly claimType: ClaimType;
  readonly target: string;
  readonly expectedResult: string;
  /** Exact text from the final response; never an invented quotation. */
  readonly sourceQuote?: string;
  readonly expectation?: ClaimExpectation;
}

/** Machine-readable assertions. A changed hash cannot prove functional behavior. */
export interface ClaimExpectation {
  readonly outcome: "success" | "failure";
  readonly basis: "operation" | "behavior" | "unverifiable";
  readonly passed?: number;
  readonly failed?: number;
  readonly skipped?: number;
  readonly paths?: readonly string[];
}

/**
 * Redacted evidence supplied to deterministic verification.
 *
 * promptId is deliberately part of every item so a verifier can fail closed
 * instead of accidentally combining evidence from two prompts in one chat.
 */
export interface VerificationEvidence {
  readonly promptId: string;
  readonly eventId: string;
  readonly sequenceNumber: number;
  readonly eventType: TraceEventType;
  readonly outcome: TraceEventOutcome;
  readonly occurredAt: string;
  readonly target?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Immutable normalized evidence record.
 *
 * TMetadata allows later phases to provide strongly typed file, command, test,
 * or architecture evidence without weakening the common event envelope.
 */
export interface TraceEventRecord<
  TMetadata extends Readonly<Record<string, unknown>> = Readonly<
    Record<string, unknown>
  >,
> extends VerificationSessionIdentity {
  readonly eventId: string;
  readonly sequenceNumber: number;
  readonly eventType: TraceEventType;
  readonly outcome: TraceEventOutcome;
  /** ISO-8601 UTC timestamp supplied by the trusted ingestion boundary. */
  readonly occurredAt: string;
  readonly target?: string;
  readonly metadata: TMetadata;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
}

/** Minimal evidence pointer stored with an AgentClaim verifier decision. */
export interface EvidenceReference {
  readonly eventId: string;
  readonly sequenceNumber: number;
  readonly eventType: TraceEventType;
}

/** Result produced by deterministic verification; the extractor cannot set it. */
export interface ClaimVerificationResult {
  readonly claimIndex: number;
  readonly verdict: VerificationVerdict;
  readonly reasonCode: VerdictReasonCode;
  readonly explanation: string;
  readonly evidence: readonly EvidenceReference[];
  readonly ruleVersion: string;
}

/** Evidence captured around a file-writing tool invocation. */
export interface FileChangeEvidence extends Readonly<Record<string, unknown>> {
  readonly filePath: string;
  readonly existedBefore: boolean;
  readonly existsAfter: boolean;
  readonly fileHashBefore: string | null;
  readonly fileHashAfter: string | null;
}

/** Evidence captured when a shell, build, or test command completes. */
export interface CommandCompletionEvidence extends Readonly<
  Record<string, unknown>
> {
  readonly command: string;
  readonly workingDirectory: string;
  readonly exitCode: number;
  readonly outputHash: string;
}

/** Framework-neutral test evidence derived from a completed command. */
export interface TestCompletionEvidence extends CommandCompletionEvidence {
  readonly passed: number;
  readonly failed: number;
  readonly skipped?: number;
}
