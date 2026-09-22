import type { VerificationSession } from "@traceforge/verification-contracts";
import {
  Card,
  CardBody,
  CardHeader,
  ExecutionStatusBadge,
  ProcessingStatusBadge
} from "@/components/ui";
import { formatCount, formatDateTime, formatPercent } from "./format";
import styles from "./session-details.module.css";

export function SessionSummary({ session }: Readonly<{ session: VerificationSession }>) {
  return (
    <Card>
      <CardHeader
        title={session.projectName ?? "Unnamed project"}
        description={`Prompt ${session.promptId}`}
      />
      <CardBody className={styles.summaryBody!}>
        <div className={styles.statusGrid} aria-label="Session processing status">
          <StatusItem label="Execution">
            <ExecutionStatusBadge status={session.executionStatus} />
          </StatusItem>
          <StatusItem label="Extraction">
            <ProcessingStatusBadge status={session.extractionStatus} />
          </StatusItem>
          <StatusItem label="Verification">
            <ProcessingStatusBadge status={session.verificationStatus} />
          </StatusItem>
        </div>

        <div className={styles.summaryMetrics} aria-label="Session verification metrics">
          <Metric label="Claims" value={formatCount(session.totalClaims)} />
          <Metric label="Scored" value={formatCount(session.scoredClaims)} />
          <Metric label="Reliability" value={formatPercent(session.reliabilityPercent)} />
          <Metric label="Coverage" value={formatPercent(session.coveragePercent)} />
        </div>

        <dl className={styles.sessionMetadata}>
          <Metadata label="Agent" value={session.agentName} />
          <Metadata label="Model" value={session.modelName} />
          <Metadata label="External session" value={session.externalSessionId} mono />
          <Metadata label="Run" value={session.runId} mono />
          <Metadata label="Started" value={formatDateTime(session.startedAt)} />
          <Metadata label="Completed" value={formatDateTime(session.completedAt)} />
          {session.projectPath ? (
            <Metadata label="Project path" value={session.projectPath} mono />
          ) : null}
        </dl>
      </CardBody>
    </Card>
  );
}

function StatusItem({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className={styles.statusItem}>
      <span>{label}</span>
      {children}
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className={styles.summaryMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metadata({
  label,
  value,
  mono = false
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined}>{value}</dd>
    </div>
  );
}
