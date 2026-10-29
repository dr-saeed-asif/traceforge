import "server-only";
import {
  ContractValidationError,
  parseVerificationSessionDaysResponse,
  parseVerificationSessionDetailsResponse,
  parseVerificationSessionsResponse,
  type VerificationListQuery,
  type VerificationSession,
  type VerificationSessionDay,
  type VerificationSessionDaysResponse,
  type VerificationSessionDetailsResponse,
  type VerificationSessionsResponse
} from "@traceforge/verification-contracts";
import { loadTraceForgeApiConfig, type TraceForgeApiConfig } from "./config";
import { TraceForgeApiError } from "./errors";

type ResponseParser<T> = (value: unknown) => T;

export interface TraceForgeApiClient {
  getSessions(query?: VerificationListQuery): Promise<VerificationSessionsResponse>;
  getSessionDays(query?: VerificationListQuery): Promise<VerificationSessionDaysResponse>;
  getSessionDetails(promptId: string): Promise<VerificationSessionDetailsResponse>;
}

export interface CreateTraceForgeApiClientOptions {
  readonly config?: TraceForgeApiConfig;
  readonly fetchImplementation?: typeof fetch;
}

export function createTraceForgeApiClient(
  options: CreateTraceForgeApiClientOptions = {}
): TraceForgeApiClient {
  const config = options.config ?? loadTraceForgeApiConfig();
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new TraceForgeApiError("CONFIGURATION_ERROR", "A Fetch API implementation is required");
  }

  return {
    getSessions,
    getSessionDays,
    getSessionDetails: (promptId) => {
      const normalizedPromptId = validatePromptId(promptId);
      return request(
        `/api/v1/verification/sessions/${encodeURIComponent(normalizedPromptId)}`,
        {},
        parseVerificationSessionDetailsResponse
      );
    }
  };

  async function getSessionDays(
    query: VerificationListQuery = {}
  ): Promise<VerificationSessionDaysResponse> {
    try {
      return await request(
        "/api/v1/verification/session-days",
        query,
        parseVerificationSessionDaysResponse
      );
    } catch (error) {
      if (
        !(error instanceof TraceForgeApiError) ||
        error.code !== "HTTP_ERROR" ||
        error.status !== 404
      ) {
        throw error;
      }
      return getSessionDaysFromLegacyApi(query);
    }
  }

  async function getSessionDaysFromLegacyApi(
    query: VerificationListQuery
  ): Promise<VerificationSessionDaysResponse> {
    const sessions: VerificationSession[] = [];
    let sessionOffset = 0;
    const chunkSize = 100;

    while (true) {
      const response = await request(
        "/api/v1/verification/sessions",
        {
          ...(query.startedAfter ? { startedAfter: query.startedAfter } : {}),
          ...(query.startedBefore ? { startedBefore: query.startedBefore } : {}),
          limit: chunkSize,
          offset: sessionOffset
        },
        parseVerificationSessionsResponse
      );
      sessions.push(...response.sessions);
      if (!response.pagination.hasMore || response.sessions.length === 0) break;
      sessionOffset += response.sessions.length;
    }

    const days = groupSessionsByDay(sessions);
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const page = days.slice(offset, offset + limit);
    return {
      days: page,
      pagination: {
        limit,
        offset,
        returned: page.length,
        hasMore: offset + page.length < days.length
      }
    };
  }

  async function getSessions(
    query: VerificationListQuery = {}
  ): Promise<VerificationSessionsResponse> {
    const requestedLimit = query.limit;
    if (requestedLimit === undefined || requestedLimit >= 100) {
      return request("/api/v1/verification/sessions", query, parseVerificationSessionsResponse);
    }

    // Fetch one extra record at the server boundary. This gives the UI exact
    // next-page information even when the running API predates `hasMore`.
    const response = await request(
      "/api/v1/verification/sessions",
      { ...query, limit: requestedLimit + 1 },
      parseVerificationSessionsResponse
    );
    const sessions = response.sessions.slice(0, requestedLimit);

    return {
      sessions,
      pagination: {
        limit: requestedLimit,
        offset: response.pagination.offset,
        returned: sessions.length,
        hasMore: response.sessions.length > requestedLimit || response.pagination.hasMore
      }
    };
  }

  async function request<T>(
    path: string,
    query: VerificationListQuery,
    parser: ResponseParser<T>
  ): Promise<T> {
    const url = createRequestUrl(config.baseUrl, path, query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImplementation(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.token}`
        },
        cache: "no-store",
        signal: controller.signal
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new TraceForgeApiError(
          "HTTP_ERROR",
          `TraceForge API request failed with status ${response.status}`,
          {
            status: response.status,
            ...(upstreamErrorCode(payload) ? { upstreamCode: upstreamErrorCode(payload)! } : {})
          }
        );
      }
      try {
        return parser(payload);
      } catch (error) {
        if (error instanceof ContractValidationError) {
          throw new TraceForgeApiError(
            "INVALID_RESPONSE",
            `TraceForge API returned an invalid response at ${error.path}`,
            { cause: error }
          );
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof TraceForgeApiError) throw error;
      if (controller.signal.aborted) {
        throw new TraceForgeApiError(
          "TIMEOUT",
          `TraceForge API did not respond within ${config.timeoutMs}ms`,
          { cause: error }
        );
      }
      throw new TraceForgeApiError("NETWORK_ERROR", "TraceForge API could not be reached", {
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function groupSessionsByDay(sessions: readonly VerificationSession[]): VerificationSessionDay[] {
  const grouped = new Map<string, VerificationSession[]>();
  for (const session of sessions) {
    const date = session.startedAt.slice(0, 10);
    const daySessions = grouped.get(date) ?? [];
    daySessions.push(session);
    grouped.set(date, daySessions);
  }

  return [...grouped.entries()].map(([date, daySessions]) => {
    const totalClaims = sum(daySessions, (session) => session.totalClaims);
    const verifiedClaims = sum(daySessions, (session) => session.verifiedClaims);
    const contradictedClaims = sum(daySessions, (session) => session.contradictedClaims);
    const unsupportedClaims = sum(daySessions, (session) => session.unsupportedClaims);
    const unverifiableClaims = sum(daySessions, (session) => session.unverifiableClaims);
    const scoredClaims = verifiedClaims + contradictedClaims + unsupportedClaims;
    return {
      date,
      queries: daySessions.length,
      totalClaims,
      verifiedClaims,
      contradictedClaims,
      unsupportedClaims,
      unverifiableClaims,
      reliabilityPercent:
        scoredClaims === 0 ? null : Math.round((verifiedClaims / scoredClaims) * 1000) / 10,
      sessions: daySessions
    };
  });
}

function sum(
  sessions: readonly VerificationSession[],
  select: (session: VerificationSession) => number
): number {
  return sessions.reduce((total, session) => total + select(session), 0);
}

function createRequestUrl(baseUrl: string, path: string, query: VerificationListQuery): URL {
  validateListQuery(query);
  const url = new URL(path, `${baseUrl}/`);
  if (query.limit !== undefined) url.searchParams.set("limit", String(query.limit));
  if (query.offset !== undefined) url.searchParams.set("offset", String(query.offset));
  if (query.startedAfter !== undefined) url.searchParams.set("startedAfter", query.startedAfter);
  if (query.startedBefore !== undefined) url.searchParams.set("startedBefore", query.startedBefore);
  return url;
}

function validateListQuery(query: VerificationListQuery): void {
  if (
    query.limit !== undefined &&
    (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100)
  ) {
    invalidRequest("limit must be an integer from 1 through 100");
  }
  if (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0)) {
    invalidRequest("offset must be a non-negative integer");
  }
  const startedAfter =
    query.startedAfter === undefined ? undefined : validDate(query.startedAfter, "startedAfter");
  const startedBefore =
    query.startedBefore === undefined ? undefined : validDate(query.startedBefore, "startedBefore");
  if (startedAfter !== undefined && startedBefore !== undefined && startedAfter >= startedBefore) {
    invalidRequest("startedAfter must be earlier than startedBefore");
  }
}

function validatePromptId(promptId: string): string {
  const normalized = promptId.trim();
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return invalidRequest("promptId must be a non-empty identifier of at most 128 characters");
  }
  return normalized;
}

function validDate(value: string, name: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return invalidRequest(`${name} must be a valid ISO-8601 timestamp`);
  return timestamp;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    // Preserve the HTTP status as the primary failure for non-JSON upstream
    // errors (for example a reverse-proxy 502 HTML response).
    if (!response.ok) return undefined;
    throw new TraceForgeApiError("INVALID_RESPONSE", "TraceForge API returned malformed JSON", {
      status: response.status,
      cause: error
    });
  }
}

function upstreamErrorCode(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() !== "" ? error : undefined;
}

function invalidRequest(message: string): never {
  throw new TraceForgeApiError("INVALID_REQUEST", message);
}
