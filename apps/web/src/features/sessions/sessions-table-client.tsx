"use client";

import { SessionsTable } from "@/features/sessions/sessions-table";
import { SessionPagination } from "@/features/sessions/session-pagination";
import { ButtonLink, EmptyState, ErrorState } from "@/components/ui";
import { PageContainer, PageHeader } from "@/components/page-container";
import { SessionFilter } from "@/features/sessions/session-filter";
import styles from "@/features/sessions/sessions.module.css";

interface SessionsContentProps {
  days: readonly import("@traceforge/verification-contracts").VerificationSessionDay[];
  values: Readonly<{ from: string; to: string }>;
  page: number;
  returned: number;
  hasMore: boolean;
  sessionListHref: (values: Readonly<{ from: string; to: string }>, page: number) => string;
}

export function SessionsContent({
  days,
  values,
  page,
  returned,
  hasMore,
  sessionListHref
}: SessionsContentProps) {
  if (days.length === 0) {
    return (
      <EmptyState
        title={page > 1 ? "No sessions on this page" : "No sessions found"}
        description={
          page > 1
            ? "This page has no captured sessions. Return to the previous page to continue browsing."
            : "No captured sessions match this date range. Adjust the filter or run a traced prompt first."
        }
        action={
          page > 1 ? (
            <ButtonLink href={sessionListHref(values, page - 1)}>Previous page</ButtonLink>
          ) : (
            <ButtonLink href="/sessions">Show all dates</ButtonLink>
          )
        }
      />
    );
  }

  return (
    <section className={styles.tableCard} aria-labelledby="session-results-title">
      <header className={styles.tableSummary}>
        <div>
          <h2 id="session-results-title">Daily claim verification summary</h2>
          <p>Select a date to inspect its prompts, verdicts, and supporting evidence.</p>
        </div>
      </header>
      <SessionsTable days={days} />
      <SessionPagination values={values} page={page} returned={returned} hasMore={hasMore} />
    </section>
  );
}

interface SessionsErrorProps {
  description: string;
  action: React.ReactNode;
}

export function SessionsError({ description, action }: SessionsErrorProps) {
  return <ErrorState description={description} action={action} />;
}

interface SessionsFrameProps {
  values: Readonly<{ from: string; to: string }>;
  children: React.ReactNode;
}

export function SessionsFrame({ values, children }: SessionsFrameProps) {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Evidence audit"
        title="Agent verification sessions"
        description="Review captured agent runs and inspect each extracted claim against its supporting trace evidence."
      />
      <div className={styles.listStack}>
        <div className={styles.filterPanel}>
          <SessionFilter values={values} />
        </div>
        {children}
      </div>
    </PageContainer>
  );
}
