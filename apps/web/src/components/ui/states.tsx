import type { ReactNode } from "react";
import { Icon } from "../icons";
import styles from "./ui.module.css";

export function LoadingState({
  label = "Loading verification data"
}: Readonly<{ label?: string }>) {
  return (
    <div className={styles.loadingState} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className={styles.skeletonHeading} />
      <div className={styles.skeletonLine} />
      <div className={styles.skeletonLineShort} />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action
}: Readonly<{ title: string; description: string; action?: ReactNode }>) {
  return (
    <div className={styles.state}>
      <span className={styles.stateIcon}>
        <Icon name="inbox" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className={styles.stateAction}>{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Unable to load verification data",
  description,
  action
}: Readonly<{ title?: string; description: string; action?: ReactNode }>) {
  return (
    <div className={`${styles.state} ${styles.errorState}`} role="alert">
      <span className={styles.stateIcon}>
        <Icon name="warning" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className={styles.stateAction}>{action}</div> : null}
    </div>
  );
}
