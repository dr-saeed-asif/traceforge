import type { VerificationListQuery } from "@traceforge/verification-contracts";

export interface SessionDateValues {
  readonly from: string;
  readonly to: string;
}

export interface SessionDateRange {
  readonly values: SessionDateValues;
  readonly query: Pick<VerificationListQuery, "startedAfter" | "startedBefore">;
  readonly error: string | null;
}

export type SessionSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export function parseSessionDateRange(searchParams: SessionSearchParams): SessionDateRange {
  const values = {
    from: firstValue(searchParams.from),
    to: firstValue(searchParams.to)
  };

  if ((values.from && !validDateInput(values.from)) || (values.to && !validDateInput(values.to))) {
    return { values, query: {}, error: "Choose valid calendar dates for the session range." };
  }
  if (values.from && values.to && values.from > values.to) {
    return { values, query: {}, error: "The start date must be on or before the end date." };
  }

  return {
    values,
    query: {
      ...(values.from ? { startedAfter: `${values.from}T00:00:00.000Z` } : {}),
      ...(values.to ? { startedBefore: nextUtcDay(values.to) } : {})
    },
    error: null
  };
}

function firstValue(value: string | readonly string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : "";
}

function validDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nextUtcDay(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}
