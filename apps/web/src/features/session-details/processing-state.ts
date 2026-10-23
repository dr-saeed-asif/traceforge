import type { VerificationSession } from "@traceforge/verification-contracts";

export function isProcessing(session: VerificationSession) {
  return (
    session.executionStatus === "IN_PROGRESS" ||
    session.extractionStatus === "PENDING" ||
    session.verificationStatus === "PENDING"
  );
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "Not recorded";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
