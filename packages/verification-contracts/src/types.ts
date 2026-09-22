export const EXECUTION_STATUSES = [
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "INTERRUPTED",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const PROCESSING_STATUSES = [
  "NOT_STARTED",
  "PENDING",
  "SUCCEEDED",
  "FAILED",
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const VERIFICATION_VERDICTS = [
  "VERIFIED",
  "CONTRADICTED",
  "UNSUPPORTED",
  "UNVERIFIABLE",
] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

export const VERDICT_REASON_CODES = [
  "REQUIRED_EVIDENCE_CONFIRMED",
  "CONTRADICTORY_EVIDENCE_FOUND",
  "MATCHING_EVIDENCE_NOT_FOUND",
  "OBJECTIVE_RULE_NOT_DEFINED",
  "EVIDENCE_IS_STALE",
  "EVIDENCE_IS_INVALID",
  "AGGREGATE_REQUIREMENTS_NOT_MET",
] as const;
export type VerdictReasonCode = (typeof VERDICT_REASON_CODES)[number];

export const CLAIM_TYPES = [
  "FILE_CREATED",
  "FILE_MODIFIED",
  "STRUCTURE_CREATED",
  "DEPENDENCY_RULE",
  "COMMAND_SUCCEEDED",
  "BUILD_PASSED",
  "TEST_PASSED",
  "TASK_COMPLETED",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const TRACE_EVENT_TYPES = [
  "PROMPT_SUBMITTED",
  "AGENT_STARTED",
  "MODEL_REQUESTED",
  "RESOURCE_ACCESSED",
  "FILE_READ",
  "FILE_CREATED",
  "FILE_MODIFIED",
  "FILE_DELETED",
  "DIRECTORY_CREATED",
  "COMMAND_STARTED",
  "COMMAND_COMPLETED",
  "BUILD_COMPLETED",
  "TEST_COMPLETED",
  "ARCHITECTURE_CHECK_COMPLETED",
  "FINAL_RESPONSE_CAPTURED",
  "AGENT_COMPLETED",
  "AGENT_FAILED",
  "SESSION_COMPLETED",
] as const;
export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

export const TRACE_EVENT_OUTCOMES = [
  "RECORDED",
  "SUCCEEDED",
  "FAILED",
] as const;
export type TraceEventOutcome = (typeof TRACE_EVENT_OUTCOMES)[number];

export type JsonValue =
  string | number | boolean | null | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface VerificationOverview {
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

export interface VerificationSession {
  readonly promptId: string;
  readonly promptQuery: string | null;
  readonly externalSessionId: string;
  readonly runId: string;
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

export interface VerificationSessionDay {
  readonly date: string;
  readonly queries: number;
  readonly totalClaims: number;
  readonly verifiedClaims: number;
  readonly contradictedClaims: number;
  readonly unsupportedClaims: number;
  readonly unverifiableClaims: number;
  readonly reliabilityPercent: number | null;
  readonly sessions: readonly VerificationSession[];
}

export interface VerificationClaim {
  readonly claimIndex: number;
  readonly claimText: string;
  readonly claimType: ClaimType;
  readonly target: string;
  readonly expectedResult: string;
  readonly verdict: VerificationVerdict | null;
  readonly reasonCode: VerdictReasonCode | null;
  readonly explanation: string | null;
  readonly evidenceEventIds: readonly string[];
  readonly extractorModel: string;
  readonly extractionPromptVersion: string;
  readonly verificationRuleVersion: string;
  readonly verifiedAt: string | null;
}

export interface VerificationTraceEvent {
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
  readonly metadata: JsonObject;
}

export interface VerificationPagination {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
}

export interface VerificationSessionPagination extends VerificationPagination {
  readonly hasMore: boolean;
}

export interface VerificationOverviewResponse {
  readonly overview: VerificationOverview;
  readonly sessions: readonly VerificationSession[];
  readonly pagination: VerificationPagination;
}

export interface VerificationSessionsResponse {
  readonly sessions: readonly VerificationSession[];
  readonly pagination: VerificationSessionPagination;
}

export interface VerificationSessionDaysResponse {
  readonly days: readonly VerificationSessionDay[];
  readonly pagination: VerificationSessionPagination;
}

export interface VerificationSessionDetailsResponse {
  readonly session: VerificationSession;
  readonly claims: readonly VerificationClaim[];
  readonly traceEvents: readonly VerificationTraceEvent[];
}

export interface VerificationListQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly startedAfter?: string;
  readonly startedBefore?: string;
}
