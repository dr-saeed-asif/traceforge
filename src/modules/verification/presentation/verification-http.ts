import type { ServerResponse } from "node:http";
import {
  MAX_VERIFICATION_PAGE_SIZE,
  VerificationQueryService
} from "../application/verification-query-service.js";

/** Client-input error that should be rendered as HTTP 400 rather than 500. */
export class HttpInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HttpInputError";
  }
}

/**
 * Handles the authenticated, read-only verification resources used by a
 * dashboard. It has no write access and delegates all persistence to the
 * application query service.
 */
export async function handleVerificationGet(
  requestUrl: URL,
  response: ServerResponse,
  queries: VerificationQueryService
): Promise<void> {
  const window = parseDateWindow(requestUrl.searchParams);
  if (requestUrl.pathname === "/api/v1/verification/overview") {
    const result = await queries.getOverview({ ...window, ...parsePage(requestUrl.searchParams) });
    return send(response, 200, result);
  }
  if (requestUrl.pathname === "/api/v1/verification/sessions") {
    const result = await queries.getSessions({ ...window, ...parsePage(requestUrl.searchParams) });
    return send(response, 200, result);
  }
  const prefix = "/api/v1/verification/sessions/";
  if (requestUrl.pathname.startsWith(prefix)) {
    const encodedPromptId = requestUrl.pathname.slice(prefix.length);
    if (!encodedPromptId || encodedPromptId.includes("/")) return send(response, 404, { error: "not_found" });
    let promptId: string;
    try {
      promptId = decodeURIComponent(encodedPromptId);
    } catch {
      throw new HttpInputError("promptId is not valid URL encoding");
    }
    const details = await queries.getSessionDetails(promptId);
    return details ? send(response, 200, details) : send(response, 404, { error: "not_found" });
  }
  return send(response, 404, { error: "not_found" });
}

function parsePage(searchParams: URLSearchParams): { limit?: number; offset?: number } {
  return {
    ...(parseIntegerParam(searchParams, "limit", 1, MAX_VERIFICATION_PAGE_SIZE) ?? {}),
    ...(parseIntegerParam(searchParams, "offset", 0, Number.MAX_SAFE_INTEGER) ?? {})
  };
}

function parseIntegerParam(
  searchParams: URLSearchParams,
  name: "limit" | "offset",
  minimum: number,
  maximum: number
): { [key in "limit" | "offset"]?: number } | undefined {
  const value = searchParams.get(name);
  if (value === null || value.trim() === "") return undefined;
  if (!/^\d+$/u.test(value)) throw new HttpInputError(`${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpInputError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return { [name]: parsed };
}

function parseDateWindow(searchParams: URLSearchParams): { startedAfter?: string; startedBefore?: string } {
  const startedAfter = parseDateParam(searchParams, "startedAfter");
  const startedBefore = parseDateParam(searchParams, "startedBefore");
  if (startedAfter && startedBefore && startedAfter >= startedBefore) {
    throw new HttpInputError("startedAfter must be earlier than startedBefore");
  }
  return {
    ...(startedAfter ? { startedAfter } : {}),
    ...(startedBefore ? { startedBefore } : {})
  };
}

function parseDateParam(searchParams: URLSearchParams, name: "startedAfter" | "startedBefore"): string | undefined {
  const value = searchParams.get(name);
  if (value === null || value.trim() === "") return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new HttpInputError(`${name} must be a valid ISO-8601 timestamp`);
  return parsed.toISOString();
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
