import type {
  ClaimVerificationResult,
  ExtractedClaim,
  VerificationEvidence,
  VerificationSessionIdentity
} from "../../domain/contracts.js";
import type { ReliabilitySummary } from "../../domain/reliability.js";
import type { ExecutionStatus, ProcessingStatus } from "../../domain/statuses.js";
import type { TraceEventOutcome, TraceEventType } from "../../domain/trace-event-types.js";
import type { VerificationVerdict, VerdictReasonCode } from "../../domain/verdicts.js";

export interface CreateVerificationSessionInput extends VerificationSessionIdentity {
  readonly promptResultId: number | null;
  readonly projectName: string | null;
  readonly projectPath: string | null;
  readonly agentName: string;
  readonly modelName: string;
  readonly policyVersion: string;
  readonly startedAt: string;
}

/** Frequently queried projections copied out of the full event metadata JSON. */
export interface TraceEventProjections {
  readonly toolName?: string;
  readonly filePath?: string;
  readonly command?: string;
  readonly workingDirectory?: string;
  readonly exitCode?: number;
  readonly testPassed?: number;
  readonly testFailed?: number;
  readonly testSkipped?: number;
  readonly fileExistedBefore?: boolean;
  readonly fileExistsAfter?: boolean;
  readonly fileHashBefore?: string;
  readonly fileHashAfter?: string;
  readonly outputHash?: string;
}

export interface AppendTraceEventInput extends VerificationSessionIdentity {
  readonly sourceEventId: string;
  readonly eventType: TraceEventType;
  readonly outcome: TraceEventOutcome;
  readonly occurredAt: string;
  readonly target?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly projections?: TraceEventProjections;
}

export interface AppendTraceEventResult {
  readonly traceEventId: number;
  readonly sequenceNumber: number;
  readonly eventHash: string;
  readonly deduplicated: boolean;
}

export interface SaveExtractedClaimInput extends ExtractedClaim {
  readonly promptId: string;
  readonly extractorModel: string;
  readonly extractionPromptVersion: string;
  readonly verificationRuleVersion: string;
}

export interface SaveClaimVerificationInput extends ClaimVerificationResult {
  readonly promptId: string;
  readonly verifiedAt: string;
}

export interface UpdateVerificationSessionSummaryInput {
  readonly promptId: string;
  readonly executionStatus: ExecutionStatus;
  readonly extractionStatus: ProcessingStatus;
  readonly verificationStatus: ProcessingStatus;
  readonly summary: ReliabilitySummary;
  readonly completedAt: string | null;
}

export interface ListVerificationSessionsInput {
  readonly limit: number;
  readonly offset: number;
  readonly startedAfter?: string;
  readonly startedBefore?: string;
}

/** Read model used by the Phase 5 overview endpoint. */
export interface VerificationSessionSummaryRecord extends VerificationSessionIdentity {
  readonly promptQuery: string | null;
  readonly projectName: string | null;
  readonly projectPath: string | null;
  readonly agentName: string;
  readonly modelName: string;
  readonly executionStatus: ExecutionStatus;
  readonly extractionStatus: ProcessingStatus;
  readonly verificationStatus: ProcessingStatus;
  readonly totalClaims: number;
  readonly verifiedClaims: number;
  readonly contradictedClaims: number;
  readonly unsupportedClaims: number;
  readonly unverifiableClaims: number;
  readonly scoredClaims: number;
  readonly reliabilityPercent: number | null;
  readonly coveragePercent: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface VerificationSessionDayRecord {
  readonly date: string;
  readonly queries: number;
  readonly totalClaims: number;
  readonly verifiedClaims: number;
  readonly contradictedClaims: number;
  readonly unsupportedClaims: number;
  readonly unverifiableClaims: number;
  readonly reliabilityPercent: number | null;
  readonly sessions: readonly VerificationSessionSummaryRecord[];
}

export interface VerificationClaimRecord extends ExtractedClaim {
  readonly verdict: VerificationVerdict | null;
  readonly reasonCode: VerdictReasonCode | null;
  readonly explanation: string | null;
  readonly evidenceEventIds: readonly string[];
  readonly extractorModel: string;
  readonly extractionPromptVersion: string;
  readonly verificationRuleVersion: string;
  readonly verifiedAt: string | null;
}

export interface VerificationTraceEventRecord {
  readonly id: number;
  readonly eventId: string;
  readonly sequenceNumber: number;
  readonly eventType: TraceEventType;
  readonly outcome: TraceEventOutcome;
  readonly occurredAt: string;
  readonly target: string | null;
  readonly toolName: string | null;
  readonly filePath: string | null;
  readonly command: string | null;
  readonly workingDirectory: string | null;
  readonly exitCode: number | null;
  readonly testPassed: number | null;
  readonly testFailed: number | null;
  readonly testSkipped: number | null;
  readonly fileExistedBefore: boolean | null;
  readonly fileExistsAfter: boolean | null;
  readonly fileHashBefore: string | null;
  readonly fileHashAfter: string | null;
  readonly outputHash: string | null;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
  /** Metadata is already redacted at the capture boundary. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface VerificationSessionDetails {
  readonly session: VerificationSessionSummaryRecord;
  readonly claims: readonly VerificationClaimRecord[];
  readonly traceEvents: readonly VerificationTraceEventRecord[];
}

export interface VerificationOverviewRecord {
  readonly totalSessions: number;
  readonly totalClaims: number;
  readonly verifiedClaims: number;
  readonly contradictedClaims: number;
  readonly unsupportedClaims: number;
  readonly unverifiableClaims: number;
  readonly scoredClaims: number;
  readonly reliabilityPercent: number | null;
  readonly coveragePercent: number | null;
}

/** Persistence boundary implemented by the active database adapter. */
export interface VerificationRepository {
  createSession(input: CreateVerificationSessionInput): Promise<void>;
  attachPromptResult(promptId: string, promptResultId: number): Promise<void>;
  appendTraceEvent(input: AppendTraceEventInput): Promise<AppendTraceEventResult>;
  /** Loads immutable evidence through the canonical prompt_id boundary. */
  loadVerificationEvidence(promptId: string): Promise<readonly VerificationEvidence[]>;
  saveExtractedClaim(input: SaveExtractedClaimInput): Promise<void>;
  saveClaimVerification(input: SaveClaimVerificationInput): Promise<void>;
  updateSessionSummary(input: UpdateVerificationSessionSummaryInput): Promise<void>;
  listSessions(input: ListVerificationSessionsInput): Promise<readonly VerificationSessionSummaryRecord[]>;
  listSessionDays(input: ListVerificationSessionsInput): Promise<readonly VerificationSessionDayRecord[]>;
  getSessionDetails(promptId: string): Promise<VerificationSessionDetails | null>;
  getOverview(input: Pick<ListVerificationSessionsInput, "startedAfter" | "startedBefore">): Promise<VerificationOverviewRecord>;
}
