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
import { AnchorLookup } from "./modules/verification/application/anchor-lookup.js";
import { readFileSync } from "node:fs";
import { createPublicKey } from "node:crypto";
import {
  buildClaimRecord,
  signClaimRecord,
} from "./modules/verification/application/claim-record.js";

const config = loadConfig();
const database = openSqliteDatabase(config.databasePath);
await applySqliteMigrations(database);
const captureDir = resolve(".", "opencode-activity-captures");
const promptResultRepository = new SqlitePromptResultRepository(database);
const verificationRepository = new SqliteVerificationRepository(database);
const verificationQueries = new VerificationQueryService(
  verificationRepository,
);
const anchorLookup = new AnchorLookup(database, verificationRepository);
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
    if (request.method === "GET" && requestUrl.pathname === "/healthz") {
      let databaseReady = false;
      try {
        database.prepare("SELECT 1").get();
        databaseReady = true;
      } catch {
        databaseReady = false;
      }
      const llmReady = claimExtractor
        ? await checkLlm(config.llm!.endpoint)
        : null;
      return send(response, 200, {
        status: databaseReady ? "ok" : "error",
        checks: {
          backend: true,
          database: databaseReady,
          extraction: config.extractor === "heuristic" || llmReady === true,
          llm: config.extractor === "heuristic" ? null : llmReady,
          extractor: config.extractor,
        },
      });
    }
    if (request.headers.authorization !== `Bearer ${config.apiToken}`)
      return send(response, 401, { error: "unauthorized" });

    if (request.method === "GET")
      return await handleVerificationGet(requestUrl, response);
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

async function checkLlm(endpoint: string): Promise<boolean> {
  try {
    const url = new URL(endpoint);
    url.pathname = "/api/tags";
    url.search = "";
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

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
  if (requestUrl.pathname === "/api/v1/verification/anchor-lookup") {
    const input = Object.fromEntries(
      ["sessionHash", "manifestHash", "claimIndex"].flatMap((key) =>
        requestUrl.searchParams.has(key)
          ? [[key, requestUrl.searchParams.get(key)!]]
          : [],
      ),
    );
    return send(response, 200, await anchorLookup.search(input));
  }
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
  if (requestUrl.pathname === "/api/v1/verification/record-key") {
    const key = recordSigningKey();
    return key
      ? send(response, 200, { publicKeyPem: createPublicKey(key).export({ type: "spki", format: "pem" }) })
      : send(response, 404, { error: "record_signing_not_configured" });
  }
  const prefix = "/api/v1/verification/sessions/";
  const recordSuffix = "/claim-record";
  if (requestUrl.pathname.startsWith(prefix) && requestUrl.pathname.endsWith(recordSuffix)) {
    // Signed, artifact-bound claim record for downstream agents (in-toto/DSSE).
    const key = recordSigningKey();
    if (!key) return send(response, 404, { error: "record_signing_not_configured" });
    let promptId: string;
    try {
      promptId = decodeURIComponent(requestUrl.pathname.slice(prefix.length, -recordSuffix.length));
    } catch {
      throw new HttpInputError("promptId is not valid URL encoding");
    }
    const details = await verificationQueries.getSessionDetails(promptId);
    if (!details) return send(response, 404, { error: "not_found" });
    try {
      if (details.session.executionStatus !== "COMPLETED" || details.session.extractionStatus !== "SUCCEEDED" || details.session.verificationStatus !== "SUCCEEDED")
        return send(response, 409, { error: "record_unavailable", message: "Session processing is incomplete" });
      return send(response, 200, signClaimRecord(buildClaimRecord(details), key));
    } catch (error) {
      return send(response, 409, { error: "record_unavailable", message: (error as Error).message });
    }
  }
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

/** Ed25519 PEM key used to sign claim records (TRACEFORGE_RECORD_SIGNING_KEY_FILE). */
function recordSigningKey(): string | undefined {
  const file = process.env.TRACEFORGE_RECORD_SIGNING_KEY_FILE?.trim();
  return file ? readFileSync(file, "utf8") : undefined;
}
