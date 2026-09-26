"use client";

import type { VerificationSessionDay } from "@traceforge/verification-contracts";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/ui/data-table";
import { DailySummaryModal } from "./daily-summary-modal";
import { formatCount, formatPercent, type DailySummary, toDailySummaries } from "./daily-summary";
import styles from "./sessions.module.css";

export function SessionsTable({ days }: Readonly<{ days: readonly VerificationSessionDay[] }>) {
  const dailySummaries = useMemo(() => toDailySummaries(days), [days]);
  const [selectedDay, setSelectedDay] = useState<DailySummary | null>(null);

  return (
    <>
      <DataTable
        caption="Daily verification summary"
        rows={dailySummaries}
        getRowKey={(summary) => summary.date}
        onRowClick={setSelectedDay}
        columns={[
          {
            key: "date",
            header: "Date",
            width: "14%",
            cell: (summary) => (
              <time className={styles.tableDate} dateTime={summary.date}>
                {summary.dateDisplay}
              </time>
            )
          },
          {
            key: "queries",
            header: "Queries",
            align: "end",
            width: "10%",
            cell: (summary) => <strong>{formatCount(summary.queries)}</strong>
          },
          {
            key: "claims",
            header: "Claims",
            align: "end",
            width: "10%",
            cell: (summary) => formatCount(summary.totalClaims)
          },
          {
            key: "verified",
            header: "Verified",
            align: "end",
            width: "11%",
            cell: (summary) => (
              <span className={styles.verifiedCount}>{formatCount(summary.verifiedClaims)}</span>
            )
          },
          {
            key: "contradicted",
            header: "Contradicted",
            align: "end",
            width: "12%",
            cell: (summary) => (
              <span className={styles.contradictedCount}>
                {formatCount(summary.contradictedClaims)}
              </span>
            )
          },
          {
            key: "unsupported",
            header: "Unsupported",
            align: "end",
            width: "12%",
            cell: (summary) => (
              <span className={styles.unsupportedCount}>
                {formatCount(summary.unsupportedClaims)}
              </span>
            )
          },
          {
            key: "unverifiable",
            header: "Unverifiable",
            align: "end",
            width: "12%",
            cell: (summary) => (
              <span className={styles.unverifiableCount}>
                {formatCount(summary.unverifiableClaims)}
              </span>
            )
          },
          {
            key: "reliability",
            header: "Reliability",
            align: "end",
            width: "10%",
            cell: (summary) => (
              <strong className={styles.tableMetric}>
                {formatPercent(summary.reliabilityPercent)}
              </strong>
            )
          }
        ]}
      />
      <DailySummaryModal
        isOpen={selectedDay !== null}
        onClose={() => setSelectedDay(null)}
        day={selectedDay}
      />
    </>
  );
}
