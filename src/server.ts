import { createServer } from "node:http";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadConfig } from "./config.js";
import { PromptStore, type CaptureEvent } from "./prompt-store.js";
import {
  MAX_VERIFICATION_PAGE_SIZE,
  OllamaClaimExtractor,
  SqliteVerificationRepository,
  VerificationQueryService,
} from "./modules/verification/index.js";
import { openSqliteDatabase } from "./infrastructure/sqlite/sqlite-database.js";
import { applySqliteMigrations } from "./infrastructure/sqlite/sqlite-migrator.js";
import { SqlitePromptResultRepository } from "./infrastructure/sqlite/sqlite-prompt-result-repository.js";

const config = loadConfig();
const database = openSqliteDatabase(config.databasePath);
await applySqliteMigrations(database);
const captureDir = resolve(".", "opencode-activity-captures");
const promptResultRepository = new SqlitePromptResultRepository(database);
const verificationRepository = new SqliteVerificationRepository(database);
const verificationQueries = new VerificationQueryService(
  verificationRepository,
);
const claimExtractor =
  config.extractor === "ollama" && config.llm
    ? new OllamaClaimExtractor(config.llm)
    : undefined;
const prompts = new PromptStore(
  promptResultRepository,
  captureDir,
  config.generatedCodeKey,
  verificationRepository,
  claimExtractor,
);
await prompts.initialize();

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    if (request.method === "GET" && requestUrl.pathname === "/healthz")
      return send(response, 200, { status: "ok" });
    if (request.headers.authorization !== `Bearer ${config.apiToken}`)
      return send(response, 401, { error: "unauthorized" });

    if (request.method === "GET")
      return handleVerificationGet(requestUrl, response);
    if (request.method !== "POST")
      return send(response, 404, { error: "not_found" });

    const body = await readJson(request);
    if (requestUrl.pathname === "/api/v1/integrations/context") {
      const session = String(body.externalSessionId ?? "");
      if (!session)
        return send(response, 400, { error: "externalSessionId is required" });
      const projectPath =
        typeof body.projectPath === "string" ? body.projectPath : "";
      const runId = projectPath
        ? `run-${createHash("sha256").update(`${projectPath}\n${session}`).digest("hex")}`
        : session;
      return send(response, 200, {
        context: { taskId: `task:${runId}`, sessionId: session, runId },
      });
    }
    if (requestUrl.pathname === "/api/v1/integrations/events") {
      if (!validEvent(body))
        return send(response, 400, { error: "invalid event" });
      await prompts.ingest(body as unknown as CaptureEvent);
      return send(response, 202, { status: "accepted" });
    }
    return send(response, 404, { error: "not_found" });
  } catch (error) {
    if (
      error instanceof HttpInputError ||
      error instanceof RangeError ||
      error instanceof SyntaxError
    ) {
      return send(response, 400, { error: error.message });
    }
    console.error("[TraceForge] request failed", error);
    send(response, 500, { error: "internal_error" });
  }
});

server.listen(config.port, config.host, () =>
  process.stdout.write(
    `TraceForge listening on http://${config.host}:${config.port}\n`,
  ),
);

/** Handles the authenticated, read-only verification resources used by a dashboard. */
async function handleVerificationGet(
  requestUrl: URL,
  response: import("node:http").ServerResponse,
): Promise<void> {
  const window = parseDateWindow(requestUrl.searchParams);
  if (requestUrl.pathname === "/api/v1/verification/overview") {
    const result = await verificationQueries.getOverview({
      ...window,
      ...parsePage(requestUrl.searchParams),
    });
    return send(response, 200, result);
  }
  if (requestUrl.pathname === "/api/v1/verification/sessions") {
    const result = await verificationQueries.getSessions({
      ...window,
      ...parsePage(requestUrl.searchParams),
    });
    return send(response, 200, result);
  }
  if (requestUrl.pathname === "/api/v1/verification/session-days") {
    const result = await verificationQueries.getSessionDays({
      ...window,
      ...parsePage(requestUrl.searchParams),
    });
    return send(response, 200, result);
  }
  const prefix = "/api/v1/verification/sessions/";
  if (requestUrl.pathname.startsWith(prefix)) {
    const encodedPromptId = requestUrl.pathname.slice(prefix.length);
    if (!encodedPromptId || encodedPromptId.includes("/"))
      return send(response, 404, { error: "not_found" });
    let promptId: string;
    try {
      promptId = decodeURIComponent(encodedPromptId);
    } catch {
      throw new HttpInputError("promptId is not valid URL encoding");
    }
    const details = await verificationQueries.getSessionDetails(promptId);
    return details
      ? send(response, 200, details)
      : send(response, 404, { error: "not_found" });
  }
  return send(response, 404, { error: "not_found" });
}

function parsePage(searchParams: URLSearchParams): {
  limit?: number;
  offset?: number;
} {
  return {
    ...(parseIntegerParam(
      searchParams,
      "limit",
      1,
      MAX_VERIFICATION_PAGE_SIZE,
    ) ?? {}),
    ...(parseIntegerParam(searchParams, "offset", 0, Number.MAX_SAFE_INTEGER) ??
      {}),
  };
}

function parseIntegerParam(
  searchParams: URLSearchParams,
  name: "limit" | "offset",
  minimum: number,
  maximum: number,
): { [key in "limit" | "offset"]?: number } | undefined {
  const value = searchParams.get(name);
  if (value === null || value.trim() === "") return undefined;
  if (!/^\d+$/u.test(value))
    throw new HttpInputError(`${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpInputError(
      `${name} must be between ${minimum} and ${maximum}`,
    );
  }
  return { [name]: parsed };
}

function parseDateWindow(searchParams: URLSearchParams): {
  startedAfter?: string;
  startedBefore?: string;
} {
  const startedAfter = parseDateParam(searchParams, "startedAfter");
  const startedBefore = parseDateParam(searchParams, "startedBefore");
  if (startedAfter && startedBefore && startedAfter >= startedBefore) {
    throw new HttpInputError("startedAfter must be earlier than startedBefore");
  }
  return {
    ...(startedAfter ? { startedAfter } : {}),
    ...(startedBefore ? { startedBefore } : {}),
  };
}

function parseDateParam(
  searchParams: URLSearchParams,
  name: "startedAfter" | "startedBefore",
): string | undefined {
  const value = searchParams.get(name);
  if (value === null || value.trim() === "") return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new HttpInputError(`${name} must be a valid ISO-8601 timestamp`);
  return parsed.toISOString();
}

async function readJson(
  request: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > 8 * 1024 * 1024)
      throw new HttpInputError("request body is too large");
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpInputError("valid JSON is required");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpInputError("JSON object is required");
  return body as Record<string, unknown>;
}

class HttpInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HttpInputError";
  }
}

function validEvent(body: Record<string, unknown>): boolean {
  if (typeof body.runId !== "string" || !body.runId || body.runId.length > 255)
    return false;
  if (
    typeof body.eventType !== "string" ||
    !/^[A-Z_]{1,64}$/u.test(body.eventType)
  )
    return false;
  for (const [key, limit] of Object.entries({
    eventId: 128,
    promptId: 128,
    sessionId: 255,
    projectName: 255,
    projectPath: 4096,
  })) {
    if (
      body[key] !== undefined &&
      (typeof body[key] !== "string" || !body[key] || body[key].length > limit)
    )
      return false;
  }
  return (
    body.payload === undefined ||
    (body.payload !== null &&
      typeof body.payload === "object" &&
      !Array.isArray(body.payload))
  );
}

function send(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await prompts.drain();
  database.close();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
