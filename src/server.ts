import { createServer } from "node:http";
import { createPool } from "mysql2/promise";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { PromptStore, type CaptureEvent } from "./prompt-store.js";

const config = loadConfig();
const pool = createPool({ uri: config.databaseUrl, connectionLimit: 10, timezone: "Z" });
const captureDir = resolve(".", "opencode-activity-captures");
const prompts = new PromptStore(pool, captureDir, config.generatedCodeKey);

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") return send(response, 200, { status: "ok" });
    if (request.headers.authorization !== `Bearer ${config.apiToken}`) return send(response, 401, { error: "unauthorized" });
    if (request.method !== "POST") return send(response, 404, { error: "not_found" });
    const body = await readJson(request);
    if (request.url === "/api/v1/integrations/context") {
      const session = String(body.externalSessionId ?? "");
      if (!session) return send(response, 400, { error: "externalSessionId is required" });
      return send(response, 200, { context: { taskId: `task:${session}`, sessionId: session, runId: session } });
    }
    if (request.url === "/api/v1/integrations/events") {
      if (typeof body.runId !== "string" || typeof body.eventType !== "string") return send(response, 400, { error: "invalid event" });
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
    if (size > 64 * 1024) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
