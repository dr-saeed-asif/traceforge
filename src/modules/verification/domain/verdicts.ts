/** Final, user-visible decisions produced by deterministic verifier rules. */
export const VERIFICATION_VERDICTS = [
  "VERIFIED",
  "CONTRADICTED",
  "UNSUPPORTED",
  "UNVERIFIABLE"
] as const;

export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

/**
 * Only objective verdicts participate in reliability scoring.
 * UNVERIFIABLE remains visible but is excluded from the denominator.
 */
export const SCOREABLE_VERDICTS = ["VERIFIED", "CONTRADICTED", "UNSUPPORTED"] as const;

export type ScoreableVerdict = (typeof SCOREABLE_VERDICTS)[number];

/** Stable machine-readable explanations stored beside verifier decisions. */
export const VERDICT_REASON_CODES = [
  "REQUIRED_EVIDENCE_CONFIRMED",
  "CONTRADICTORY_EVIDENCE_FOUND",
  "MATCHING_EVIDENCE_NOT_FOUND",
  "OBJECTIVE_RULE_NOT_DEFINED",
  "EVIDENCE_IS_STALE",
  "EVIDENCE_IS_INVALID",
  "AGGREGATE_REQUIREMENTS_NOT_MET"
] as const;

export type VerdictReasonCode = (typeof VERDICT_REASON_CODES)[number];

const verdictValues = new Set<string>(VERIFICATION_VERDICTS);
const scoreableVerdictValues = new Set<string>(SCOREABLE_VERDICTS);
const reasonCodeValues = new Set<string>(VERDICT_REASON_CODES);

export function isVerificationVerdict(value: unknown): value is VerificationVerdict {
  return typeof value === "string" && verdictValues.has(value);
}

export function isScoreableVerdict(value: VerificationVerdict): value is ScoreableVerdict {
  return scoreableVerdictValues.has(value);
}

export function isVerdictReasonCode(value: unknown): value is VerdictReasonCode {
  return typeof value === "string" && reasonCodeValues.has(value);
}
