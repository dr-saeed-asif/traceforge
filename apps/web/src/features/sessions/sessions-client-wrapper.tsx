"use client";

import { useState, useEffect } from "react";
import { LoadingState } from "@/components/ui/states";
import {
  SessionsContent,
  SessionsError,
  SessionsFrame
} from "@/features/sessions/sessions-table-client";
import type { VerificationSessionDaysResponse } from "@traceforge/verification-contracts";
import type { SessionSearchParams } from "@/features/sessions/date-range";
import { parseSessionListQuery, sessionListHref } from "@/features/sessions/session-list-query";

interface SessionsClientWrapperProps {
  searchParams: Promise<SessionSearchParams>;
}

export function SessionsClientWrapper({ searchParams }: SessionsClientWrapperProps) {
  const [state, setState] = useState<{
    error?: string;
    sessionDays?: VerificationSessionDaysResponse;
    values: Readonly<{ from: string; to: string }>;
    page: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number;
    const controller = new AbortController();

    const loadData = async () => {
      const parsed = parseSessionListQuery(await searchParams);
      if (parsed.error) {
        if (!cancelled) {
          setState({ error: parsed.error, values: parsed.values, page: parsed.page });
        }
        return;
      }

      const queryParams = new URLSearchParams();
      if (parsed.query.limit) queryParams.set("limit", String(parsed.query.limit));
      if (parsed.query.offset) queryParams.set("offset", String(parsed.query.offset));
      if (parsed.query.startedAfter) queryParams.set("startedAfter", parsed.query.startedAfter);
      if (parsed.query.startedBefore) queryParams.set("startedBefore", parsed.query.startedBefore);

      try {
        const response = await fetch(`/api/sessions?${queryParams.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Failed to fetch sessions");
        const data = (await response.json()) as VerificationSessionDaysResponse;
        if (!cancelled) {
          setState({ sessionDays: data, values: parsed.values, page: parsed.page });
          timer = window.setTimeout(() => void loadData(), 5000);
        }
      } catch {
        if (!cancelled) {
          setState({
            error: "Failed to load sessions. Please try again.",
            values: parsed.values,
            page: parsed.page
          });
        }
      }
    };

    loadData();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [searchParams]);

  return (
    <SessionsFrame values={state?.values ?? { from: "", to: "" }}>
      {state?.error ? (
        <SessionsError
          description={state.error}
          action={<a href={sessionListHref(state.values, state.page)}>Try again</a>}
        />
      ) : state?.sessionDays ? (
        <SessionsContent
          days={state.sessionDays.days}
          values={state.values}
          page={state.page}
          returned={state.sessionDays.pagination.returned}
          hasMore={state.sessionDays.pagination.hasMore}
          sessionListHref={sessionListHref}
        />
      ) : (
        <LoadingState label="Loading sessions" />
      )}
    </SessionsFrame>
  );
}
