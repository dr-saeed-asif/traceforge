import type {
  ListVerificationSessionsInput,
  VerificationClaimRecord,
  VerificationOverviewRecord,
  VerificationRepository,
  VerificationSessionDayRecord,
  VerificationSessionDetails,
  VerificationSessionSummaryRecord,
  VerificationTraceEventRecord
} from "./ports/verification-repository.js";

export const DEFAULT_VERIFICATION_PAGE_SIZE = 50;
export const MAX_VERIFICATION_PAGE_SIZE = 100;

export interface VerificationQueryWindow {
  readonly startedAfter?: string;
  readonly startedBefore?: string;
}

export interface VerificationPageInput extends VerificationQueryWindow {
  readonly limit?: number;
  readonly offset?: number;
}

export interface VerificationPagination {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
}

export interface VerificationSessionListResult {
  readonly sessions: readonly VerificationSessionSummaryRecord[];
  readonly pagination: VerificationPagination & { readonly hasMore: boolean };
}

export interface VerificationSessionDayListResult {
  readonly days: readonly VerificationSessionDayRecord[];
  readonly pagination: VerificationPagination & { readonly hasMore: boolean };
}

export interface VerificationOverviewResult {
  readonly overview: VerificationOverviewRecord;
  readonly sessions: readonly VerificationSessionSummaryRecord[];
  readonly pagination: VerificationPagination;
}

/**
 * Read-only application facade for the dashboard and future API clients.
 *
 * Keeping pagination and response shaping here prevents HTTP handlers from
 * knowing SQL details and gives a frontend a stable, versionable read model.
 */
export class VerificationQueryService {
  public constructor(private readonly repository: VerificationRepository) {}

  public async getOverview(input: VerificationPageInput = {}): Promise<VerificationOverviewResult> {
    const page = normalizePage(input);
    const [overview, sessions] = await Promise.all([
      this.repository.getOverview(toWindow(input)),
      this.repository.listSessions({ ...toWindow(input), limit: page.limit, offset: page.offset })
    ]);
    return {
      overview,
      sessions: sessions.map(copySessionSummary),
      pagination: pagination(page, sessions.length)
    };
  }

  public async getSessions(input: VerificationPageInput = {}): Promise<VerificationSessionListResult> {
    const page = normalizePage(input);
    const fetchedSessions = await this.repository.listSessions({
      ...toWindow(input),
      limit: page.limit + 1,
      offset: page.offset
    });
    const hasMore = fetchedSessions.length > page.limit;
    const sessions = fetchedSessions.slice(0, page.limit);
    return {
      sessions: sessions.map(copySessionSummary),
      pagination: { ...pagination(page, sessions.length), hasMore }
    };
  }

  public async getSessionDays(input: VerificationPageInput = {}): Promise<VerificationSessionDayListResult> {
    const page = normalizePage(input);
    const fetchedDays = await this.repository.listSessionDays({
      ...toWindow(input),
      limit: page.limit + 1,
      offset: page.offset
    });
    const hasMore = fetchedDays.length > page.limit;
    const days = fetchedDays.slice(0, page.limit);
    return {
      days: days.map(copySessionDay),
      pagination: { ...pagination(page, days.length), hasMore }
    };
  }

  public async getSessionDetails(promptId: string): Promise<VerificationSessionDetails | null> {
    const normalizedPromptId = normalizePromptId(promptId);
    const details = await this.repository.getSessionDetails(normalizedPromptId);
    if (!details) return null;
    return {
      session: copySessionSummary(details.session),
      claims: details.claims.map(copyClaim),
      traceEvents: details.traceEvents.map(copyTraceEvent)
    };
  }
}

export function normalizePage(input: VerificationPageInput): Pick<ListVerificationSessionsInput, "limit" | "offset"> {
  const limit = input.limit ?? DEFAULT_VERIFICATION_PAGE_SIZE;
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_VERIFICATION_PAGE_SIZE) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_VERIFICATION_PAGE_SIZE}`);
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("offset must be a non-negative integer");
  }
  return { limit, offset };
}

export function normalizePromptId(promptId: string): string {
  const normalized = promptId.trim();
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new RangeError("promptId must be a non-empty identifier of at most 128 characters");
  }
  return normalized;
}

function toWindow(input: VerificationQueryWindow): VerificationQueryWindow {
  return {
    ...(input.startedAfter ? { startedAfter: input.startedAfter } : {}),
    ...(input.startedBefore ? { startedBefore: input.startedBefore } : {})
  };
}

function pagination(page: Pick<ListVerificationSessionsInput, "limit" | "offset">, returned: number): VerificationPagination {
  return { limit: page.limit, offset: page.offset, returned };
}

function copySessionSummary(value: VerificationSessionSummaryRecord): VerificationSessionSummaryRecord {
  return { ...value };
}

function copySessionDay(value: VerificationSessionDayRecord): VerificationSessionDayRecord {
  return { ...value, sessions: value.sessions.map(copySessionSummary) };
}

function copyClaim(value: VerificationClaimRecord): VerificationClaimRecord {
  return { ...value, evidenceEventIds: [...value.evidenceEventIds] };
}

function copyTraceEvent(value: VerificationTraceEventRecord): VerificationTraceEventRecord {
  return { ...value, metadata: { ...value.metadata } };
}
