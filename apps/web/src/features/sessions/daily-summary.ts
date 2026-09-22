import type { VerificationSession, VerificationSessionDay } from "@traceforge/verification-contracts";

export interface DailySummary {
  date: string;
  dateDisplay: string;
  queries: number;
  totalClaims: number;
  verifiedClaims: number;
  contradictedClaims: number;
  unsupportedClaims: number;
  unverifiableClaims: number;
  reliabilityPercent: number | null;
  sessions: readonly VerificationSession[];
}

export function toDailySummaries(days: readonly VerificationSessionDay[]): DailySummary[] {
  return days.map((day) => ({
    ...day,
    dateDisplay: formatDateForDisplay(`${day.date}T00:00:00.000Z`)
  }));
}

function formatDateForDisplay(isoString: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(isoString));
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number | null): string {
  return value === null
    ? "—"
    : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
