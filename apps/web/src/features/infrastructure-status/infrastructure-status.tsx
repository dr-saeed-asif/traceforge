"use client";

import { useEffect, useState } from "react";
import styles from "./infrastructure-status.module.css";

type CheckName = "frontend" | "backend" | "llm" | "extraction" | "database";
type Health = { checks: Record<CheckName, boolean | null> };
const labels: Record<CheckName, string> = {
  frontend: "Frontend",
  backend: "Backend API",
  llm: "LLM",
  extraction: "Extraction",
  database: "Database",
};

export function InfrastructureStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const result = (await response.json()) as Health;
        if (active) setHealth(result);
      } catch {
        if (active) setHealth(null);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const ready = health
    ? health.checks.frontend === true &&
      health.checks.backend === true &&
      health.checks.database === true &&
      health.checks.extraction === true &&
      health.checks.llm !== false
    : false;
  return (
    <section className={styles.panel} aria-label="Infrastructure readiness" aria-live="polite">
      <div className={styles.heading}>
        <h2>Infrastructure</h2>
        <span className={`${styles.summary} ${ready ? styles.ready : styles.waiting}`}>
          {health ? ready ? "All infrastructure is ready" : "Infrastructure needs attention" : "Checking infrastructure…"}
        </span>
      </div>
      <ul className={styles.checks}>
        {(Object.keys(labels) as CheckName[]).map((name) => {
          const value = health?.checks[name];
          const state = value === true ? "ready" : value === null ? "optional" : "waiting";
          const detail = value === true ? "Ready" : value === null ? name === "llm" && health?.checks.extraction === true ? "Not required" : "Not reported" : health ? "Unavailable" : "Checking";
          return <li key={name}><span className={`${styles.dot} ${styles[state]}`} aria-hidden="true" /><span>{labels[name]}</span><span className={styles.detail}>{detail}</span></li>;
        })}
      </ul>
    </section>
  );
}
