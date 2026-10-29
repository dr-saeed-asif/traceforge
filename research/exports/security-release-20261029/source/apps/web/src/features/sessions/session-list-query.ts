import type { VerificationListQuery } from "@traceforge/verification-contracts";
import {
  parseSessionDateRange,
  type SessionDateValues,
  type SessionSearchParams
} from "./date-range";

export const SESSIONS_PAGE_SIZE = 10;

export interface SessionListQueryState {
  readonly values: SessionDateValues;
  readonly page: number;
  readonly query: VerificationListQuery;
  readonly error: string | null;
}

export function parseSessionListQuery(searchParams: SessionSearchParams): SessionListQueryState {
  const dateRange = parseSessionDateRange(searchParams);
  const pageValue = firstValue(searchParams.page);

  if (dateRange.error) {
    return {
      values: dateRange.values,
      page: 1,
      query: {},
      error: dateRange.error
    };
  }

  if (pageValue && !/^\d+$/u.test(pageValue)) {
    return invalidPage(dateRange.values);
  }

  const page = pageValue ? Number(pageValue) : 1;
  const offset = (page - 1) * SESSIONS_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset)) {
    return invalidPage(dateRange.values);
  }

  return {
    values: dateRange.values,
    page,
    query: {
      ...dateRange.query,
      limit: SESSIONS_PAGE_SIZE,
      offset
    },
    error: null
  };
}

export function sessionListHref(values: SessionDateValues, page: number): `/sessions${string}` {
  const query = new URLSearchParams();
  if (values.from) query.set("from", values.from);
  if (values.to) query.set("to", values.to);
  if (page > 1) query.set("page", String(page));
  const serialized = query.toString();
  return serialized ? `/sessions?${serialized}` : "/sessions";
}

function firstValue(value: string | readonly string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : "";
}

function invalidPage(values: SessionDateValues): SessionListQueryState {
  return {
    values,
    page: 1,
    query: {},
    error: "Choose a valid session page number."
  };
}
