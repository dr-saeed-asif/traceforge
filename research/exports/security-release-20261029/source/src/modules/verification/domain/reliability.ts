import type { VerificationVerdict } from "./verdicts.js";
import { isScoreableVerdict } from "./verdicts.js";

export interface VerdictCounts {
  readonly totalClaims: number;
  readonly verified: number;
  readonly contradicted: number;
  readonly unsupported: number;
  readonly unverifiable: number;
}

export interface ReliabilitySummary {
  readonly counts: VerdictCounts;
  /** VERIFIED + CONTRADICTED + UNSUPPORTED. */
  readonly scoredClaims: number;
  /** VERIFIED / scoredClaims, or null when no claim can be scored. */
  readonly reliabilityPercent: number | null;
  /** scoredClaims / totalClaims, or null when there are no claims. */
  readonly coveragePercent: number | null;
}

/**
 * Calculates reliability from verdicts instead of accepting stored counters.
 * This keeps the summary derivable and prevents counter drift.
 */
export function calculateReliabilitySummary(
  verdicts: readonly VerificationVerdict[]
): ReliabilitySummary {
  const counts: VerdictCounts = {
    totalClaims: verdicts.length,
    verified: count(verdicts, "VERIFIED"),
    contradicted: count(verdicts, "CONTRADICTED"),
    unsupported: count(verdicts, "UNSUPPORTED"),
    unverifiable: count(verdicts, "UNVERIFIABLE")
  };
  const scoredClaims = verdicts.filter(isScoreableVerdict).length;

  return {
    counts,
    scoredClaims,
    reliabilityPercent: scoredClaims === 0 ? null : roundPercentage(counts.verified / scoredClaims),
    coveragePercent: counts.totalClaims === 0 ? null : roundPercentage(scoredClaims / counts.totalClaims)
  };
}

function count(verdicts: readonly VerificationVerdict[], verdict: VerificationVerdict): number {
  return verdicts.filter(value => value === verdict).length;
}

function roundPercentage(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}
