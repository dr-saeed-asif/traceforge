import type { HTMLAttributes, ReactNode } from "react";
import styles from "./ui.module.css";

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={[styles.card, className].filter(Boolean).join(" ")} {...props} />;
}

export function CardHeader({
  title,
  description
}: Readonly<{ title: string; description?: string }>) {
  return (
    <header className={styles.cardHeader}>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
    </header>
  );
}

export function CardBody({
  children,
  className
}: Readonly<{ children: ReactNode; className?: string }>) {
  return <div className={[styles.cardBody, className].filter(Boolean).join(" ")}>{children}</div>;
}
