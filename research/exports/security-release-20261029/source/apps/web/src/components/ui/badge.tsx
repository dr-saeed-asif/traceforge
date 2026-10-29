import type {
  ExecutionStatus,
  ProcessingStatus,
  VerificationVerdict
} from "@traceforge/verification-contracts";
import type { ReactNode } from "react";
import styles from "./ui.module.css";

export type BadgeTone = "neutral" | "info" | "success" | "danger" | "warning";

export function Badge({
  children,
  tone = "neutral"
}: Readonly<{ children: ReactNode; tone?: BadgeTone }>) {
  return <span className={`${styles.badge} ${styles[`badge-${tone}`]}`}>{children}</span>;
}

const verdictTone = {
  VERIFIED: "success",
  CONTRADICTED: "danger",
  UNSUPPORTED: "warning",
  UNVERIFIABLE: "neutral"
} as const satisfies Record<VerificationVerdict, BadgeTone>;

export function VerdictBadge({ verdict }: Readonly<{ verdict: VerificationVerdict | null }>) {
  if (verdict === null) return <Badge tone="neutral">Pending verdict</Badge>;
  return (
    <Badge tone={verdictTone[verdict]}>
      <span className={styles.badgeDot} aria-hidden="true" />
      {humanize(verdict)}
    </Badge>
  );
}

const statusTone = {
  NOT_STARTED: "neutral",
  PENDING: "info",
  SUCCEEDED: "success",
  FAILED: "danger"
} as const satisfies Record<ProcessingStatus, BadgeTone>;

export function ProcessingStatusBadge({ status }: Readonly<{ status: ProcessingStatus }>) {
  return (
    <Badge tone={statusTone[status]}>
      <span
        className={status === "PENDING" ? styles.badgeSpinner : styles.badgeDot}
        aria-hidden="true"
      />
      {status === "PENDING" ? "Processing" : humanize(status)}
    </Badge>
  );
}

const executionStatusTone = {
  IN_PROGRESS: "info",
  COMPLETED: "success",
  FAILED: "danger",
  INTERRUPTED: "warning"
} as const satisfies Record<ExecutionStatus, BadgeTone>;

export function ExecutionStatusBadge({ status }: Readonly<{ status: ExecutionStatus }>) {
  return (
    <Badge tone={executionStatusTone[status]}>
      <span
        className={status === "IN_PROGRESS" ? styles.badgeSpinner : styles.badgeDot}
        aria-hidden="true"
      />
      {humanize(status)}
    </Badge>
  );
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
