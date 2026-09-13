import { createServer } from "node:http";
import { createPool } from "mysql2/promise";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadConfig } from "./config.js";
import { PromptStore, type CaptureEvent } from "./prompt-store.js";

const config = loadConfig();
const pool = createPool({ uri: config.databaseUrl, connectionLimit: 10, timezone: "Z" });
const captureDir = resolve(".", "opencode-activity-captures");
const prompts = new PromptStore(pool, captureDir, config.generatedCodeKey);
await prompts.initialize();

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") return send(response, 200, { status: "ok" });
    if (request.headers.authorization !== `Bearer ${config.apiToken}`) return send(response, 401, { error: "unauthorized" });
    if (request.method !== "POST") return send(response, 404, { error: "not_found" });
    const body = await readJson(request);
    if (request.url === "/api/v1/integrations/context") {
      const session = String(body.externalSessionId ?? "");
      if (!session) return send(response, 400, { error: "externalSessionId is required" });
      const projectPath = typeof body.projectPath === "string" ? body.projectPath : "";
      const runId = projectPath ? `run-${createHash("sha256").update(`${projectPath}\n${session}`).digest("hex")}` : session;
      return send(response, 200, { context: { taskId: `task:${runId}`, sessionId: session, runId } });
    }
    if (request.url === "/api/v1/integrations/events") {
      if (!validEvent(body)) return send(response, 400, { error: "invalid event" });
      await prompts.ingest(body as unknown as CaptureEvent);
      return send(response, 202, { status: "accepted" });
    }
    return send(response, 404, { error: "not_found" });
  } catch (error) {
    send(response, 500, { error: error instanceof Error ? error.message : "internal_error" });
  }
});

server.listen(config.port, config.host, () => process.stdout.write(`TraceForge listening on http://${config.host}:${config.port}\n`));

async function readJson(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > 8 * 1024 * 1024) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON object is required");
  return body as Record<string, unknown>;
}

function validEvent(body: Record<string, unknown>): boolean {
  if (typeof body.runId !== "string" || !body.runId || body.runId.length > 255) return false;
  if (typeof body.eventType !== "string" || !/^[A-Z_]{1,64}$/u.test(body.eventType)) return false;
  for (const [key, limit] of Object.entries({ eventId: 128, promptId: 128, sessionId: 255, projectName: 255, projectPath: 4096 })) {
    if (body[key] !== undefined && (typeof body[key] !== "string" || !body[key] || body[key].length > limit)) return false;
  }
  return body.payload === undefined || (body.payload !== null && typeof body.payload === "object" && !Array.isArray(body.payload));
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await prompts.drain();
  await pool.end();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
