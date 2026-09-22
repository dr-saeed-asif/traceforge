import type { ReactNode } from "react";
import styles from "./page-container.module.css";

export function PageContainer({
  children,
  size = "wide"
}: Readonly<{ children: ReactNode; size?: "wide" | "narrow" }>) {
  return (
    <div
      className={`${styles.pageContainer} ${size === "narrow" ? styles.pageContainerNarrow : ""}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: Readonly<{ eyebrow?: string; title: string; description?: string; actions?: ReactNode }>) {
  return (
    <div className={styles.pageHeader}>
      <div>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className={styles.pageDescription}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </div>
  );
}
