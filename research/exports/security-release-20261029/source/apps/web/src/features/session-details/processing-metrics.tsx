"use client";

import { useEffect, useState } from "react";
import type {
  VerificationSession,
  VerificationTraceEvent
} from "@traceforge/verification-contracts";
import styles from "./processing-metrics.module.css";

import { isProcessing, formatDuration } from "./processing-state";

export function ProcessingMetricsPanel({
  session,
  extractorModel,
  traceEvents = []
}: {
  session: VerificationSession;
  extractorModel?: string | undefined;
  traceEvents?: readonly VerificationTraceEvent[];
}) {
  const [now, setNow] = useState<number | null>(null);
  const active = isProcessing(session);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const metrics = session.processingMetrics;
  const elapsed = (start: string, end: string | null) =>
    end
      ? Math.max(0, Date.parse(end) - Date.parse(start))
      : now === null
        ? null
        : Math.max(0, now - Date.parse(start));
  const firstTool = traceEvents.find(
    (event) => event.eventType === "COMMAND_STARTED" || event.toolName !== null
  );
  const phase =
    session.executionStatus === "IN_PROGRESS"
      ? "Waiting for OpenCode execution and its final response. Ready infrastructure does not mean the agent has finished."
      : session.extractionStatus === "PENDING"
        ? "Extracting claims from the final response. Local model loading, generation, and output repair can take time."
        : session.verificationStatus === "PENDING"
          ? "Checking claims against captured evidence with deterministic rules."
          : session.extractionStatus === "FAILED"
            ? "Claim extraction failed. Recorded time includes the failed attempt."
            : session.verificationStatus === "FAILED"
              ? "Verification failed. Recorded time includes the failed attempt."
              : session.extractionStatus === "NOT_STARTED"
                ? "Waiting for the final response before extraction can start."
                : "Processing complete.";
  return (
    <section className={styles.panel} aria-label="Processing latency metrics">
      <p className={styles.phase} role="status">
        {active ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {phase}
      </p>
      <dl className={styles.grid}>
        <Metric label="Agent model" value={session.modelName} />
        <Metric
          label="Extraction model"
          value={metrics?.extractorModel ?? extractorModel ?? "Not recorded yet"}
        />
        <Metric label="Verification engine" value="Deterministic rules (no LLM)" />
        <Metric
          label="Extractor call time"
          value={formatDuration(
            metrics?.extractorDurationMs ??
              (session.extractionStatus === "PENDING" && metrics
                ? elapsed(metrics.extractionStartedAt, null)
                : null)
          )}
        />
        <Metric
          label="Execution elapsed"
          value={formatDuration(elapsed(session.startedAt, session.completedAt))}
        />
        <Metric
          label="Time to first tool"
          value={formatDuration(
            firstTool ? elapsed(session.startedAt, firstTool.occurredAt) : null
          )}
        />
        <Metric
          label="Extraction elapsed"
          value={formatDuration(
            metrics?.extractionDurationMs ??
              (metrics ? elapsed(metrics.extractionStartedAt, metrics.extractionCompletedAt) : null)
          )}
        />
        <Metric
          label="Verification elapsed"
          value={formatDuration(
            metrics?.verificationDurationMs ??
              (metrics?.verificationStartedAt
                ? elapsed(metrics.verificationStartedAt, metrics.verificationCompletedAt)
                : null)
          )}
        />
      </dl>
      <p className={styles.note}>
        Extractor call time includes model loading, generation, and any repair request. Extraction
        includes saving claims. Verification includes loading evidence and saving verdicts. Times
        are recorded for new processing attempts.
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
