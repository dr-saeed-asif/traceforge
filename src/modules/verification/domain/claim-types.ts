/**
 * Stable claim categories produced by the claim extractor.
 *
 * These values are persisted, so renaming one requires an explicit data
 * migration and a verifier-policy version change.
 */
export const CLAIM_TYPES = [
  "FILE_CREATED",
  "FILE_MODIFIED",
  "STRUCTURE_CREATED",
  "DEPENDENCY_RULE",
  "COMMAND_SUCCEEDED",
  "BUILD_PASSED",
  "TEST_PASSED",
  "TASK_COMPLETED"
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];

const claimTypeValues = new Set<string>(CLAIM_TYPES);

/** Validates untrusted extractor or database values at runtime. */
export function isClaimType(value: unknown): value is ClaimType {
  return typeof value === "string" && claimTypeValues.has(value);
}
