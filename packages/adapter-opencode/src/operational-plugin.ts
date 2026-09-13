import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import { DurableOutbox } from "./durable-outbox.js";

interface Context {
  readonly taskId: string;
  readonly sessionId: string;
  readonly runId: string;
}

interface TextPart {
  readonly id?: string;
  readonly messageID?: string;
  readonly type: string;
  readonly text?: string;
  readonly time?: { readonly end?: number };
}

interface PendingEvent {
  sessionId: string;
  eventId: string;
  occurredAt: string;
  eventType: string;
  promptId?: string;
  payload: Record<string, unknown>;
  actor?: { name: string };
}

export const TraceForgePlugin: Plugin = async (input) => {
  const settings = loadSettings();
  const apiUrl = settings.TRACEFORGE_API_URL ?? "http://127.0.0.1:8080";
  const token = settings.TRACEFORGE_API_TOKEN;
  const workspace = input.directory || input.worktree;
  const projectPath = resolve(workspace).replace(/\\/gu, "/");
  const projectName = basename(workspace);
  if (!token) {
    console.warn("[TraceForge] TRACEFORGE_API_TOKEN is unavailable; capture disabled");
    return {};
  }

  const contexts = new Map<string, Promise<Context>>();
  const contextFor = (sessionId: string) => {
    let context = contexts.get(sessionId);
    if (!context) {
      context = post<{ context: Context }>(apiUrl, token, "/api/v1/integrations/context", {
        externalSessionId: sessionId, projectPath, projectName
      }).then(value => value.context).catch(error => { contexts.delete(sessionId); throw error; });
      contexts.set(sessionId, context);
    }
    return context;
  };
  const prompts = new Map<string, string>();
  const messages = new Map<string, { role: string; parentID?: string }>();
  const promptIdFor = (sessionId: string, messageId: string) => digest(`${projectPath}:${sessionId}:${messageId}`);
  const outboxPath = settings.TRACEFORGE_OUTBOX_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../.traceforge/outbox", digest(`${apiUrl}:${projectPath}`));
  const outbox = new DurableOutbox<PendingEvent>(outboxPath, async entry => {
    let promptId = entry.promptId;
    let payload = entry.payload;
    if (entry.eventType === "MODEL_RESPONSE") {
      const messageId = String(payload.messageId);
      const key = `${entry.sessionId}:${messageId}`;
      let info = messages.get(key);
      if (!info) {
        const response = await input.client.session.message({ path: { id: entry.sessionId, messageID: messageId }, query: { directory: workspace }, signal: AbortSignal.timeout(10_000) });
        if (!response.data) throw new Error("Message role lookup failed; response remains queued");
        info = response.data.info;
        messages.set(key, info);
      }
      if (info.role !== "assistant") return;
      if (info.parentID) promptId = promptIdFor(entry.sessionId, info.parentID);
      payload = { ...payload, role: "assistant" };
    }
    const context = await contextFor(entry.sessionId);
    await post(apiUrl, token, "/api/v1/integrations/events", {
      ...entry, ...context, projectName, projectPath, payload, ...(promptId ? { promptId } : {})
    });
  });
  await outbox.start();
  const capture = async (sessionId: string, eventType: string, payload: Record<string, unknown>, actor?: { name: string }, identity?: string) => {
    const promptId = prompts.get(sessionId);
    await outbox.enqueue({
      sessionId, eventType, payload, eventId: identity ? digest(`${projectPath}:${sessionId}:${eventType}:${identity}`) : randomUUID(),
      occurredAt: new Date().toISOString(), ...(promptId ? { promptId } : {}), ...(actor ? { actor } : {})
    });
  };

  // Generic event callbacks are not awaited by OpenCode: serialize them with direct hooks.
  const queues = new Map<string, Promise<void>>();
  const serial = (sessionId: string, work: () => Promise<void>): Promise<void> => {
    const pending = (queues.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(sessionId, pending);
    return pending.finally(() => { if (queues.get(sessionId) === pending) queues.delete(sessionId); });
  };

  return {
    dispose: async () => { await Promise.allSettled(queues.values()); await outbox.close(); },
    "chat.message": async (chat, output) => serial(chat.sessionID, async () => {
      const model = chat.model ?? output.message.model;
      const agent = chat.agent ?? output.message.agent ?? "OpenCode";
      const content = output.parts.filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
      const messageId = output.message.id ?? chat.messageID ?? randomUUID();
      const promptId = promptIdFor(chat.sessionID, messageId);
      prompts.set(chat.sessionID, promptId);
      messages.set(`${chat.sessionID}:${messageId}`, { role: "user" });
      const gitUser = await getGitIdentity(workspace);
      await capture(chat.sessionID, "PROMPT_SUBMITTED", { content, agent, model: model.modelID, gitUser, messageId }, undefined, promptId);
      await capture(chat.sessionID, "AGENT_STARTED", { agentName: agent }, { name: agent }, promptId);
      await capture(chat.sessionID, "MODEL_REQUEST", { model: model.modelID, provider: model.providerID }, { name: model.modelID }, promptId);
    }),
    event: async ({ event }) => {
      const properties = event.properties as Record<string, unknown>;
      const sessionId = sessionIdOf(properties);
      if (!sessionId) return;
      // Populate role metadata immediately, even while an earlier part awaits delivery.
      if (event.type === "message.updated" && isRecord(properties.info)) {
        const info = properties.info;
        if (typeof info.id === "string" && typeof info.role === "string") messages.set(`${sessionId}:${info.id}`, { role: info.role, ...(typeof info.parentID === "string" ? { parentID: info.parentID } : {}) });
      }
      return serial(sessionId, async () => {
      if (event.type === "session.idle") await capture(sessionId, "AGENT_COMPLETED", { status: "COMPLETED" }, undefined, prompts.get(sessionId));
      if (event.type === "session.deleted") await capture(sessionId, "SESSION_COMPLETED", { status: "COMPLETED" }, undefined, prompts.get(sessionId));
      if (event.type === "session.error") await capture(sessionId, "AGENT_FAILED", { status: "FAILED" }, undefined, prompts.get(sessionId));
      if (event.type === "message.part.updated") {
        const part = properties.part as TextPart | undefined;
        if (part?.type === "text" && typeof part.text === "string" && part.time?.end !== undefined && part.id && part.messageID) {
          const info = messages.get(`${sessionId}:${part.messageID}`);
          if (info?.role === "user") return;
          await capture(sessionId, "MODEL_RESPONSE", { responseText: part.text, messageId: part.messageID, partId: part.id }, undefined, `${part.messageID}:${part.id}`);
        }
      }
      });
    },
    "tool.execute.after": async (input) => serial(input.sessionID, async () => {
      const resources = resourcesForTool(input.tool, input.args, workspace);
      for (const resource of resources) await capture(input.sessionID, "RESOURCE_ACCESSED", resource, undefined, `${input.callID}:${JSON.stringify(resource)}`);
      for (const generated of await generatedCodeFor(resources, input.tool, workspace)) {
        await capture(input.sessionID, "GENERATED_CODE_CAPTURED", generated, undefined, `${input.callID}:${String(generated.path)}`);
      }
    })
  };
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function post<T = unknown>(base: string, token: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${base.replace(/\/$/u, "")}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function loadSettings(): Record<string, string> {
  const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
  const path = process.env.TRACEFORGE_RUNTIME_ENV ?? rootEnv;
  const values = { ...process.env } as Record<string, string>;
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
      const match = /^([^#=\s]+)=(.*)$/u.exec(line);
      if (match?.[1]) values[match[1]] = match[2] ?? "";
    }
  }
  return values;
}

function sessionIdOf(properties: Record<string, unknown>): string | null {
  if (typeof properties.sessionID === "string") return properties.sessionID;
  const info = properties.info as { sessionID?: unknown; id?: unknown } | undefined;
  if (typeof info?.sessionID === "string") return info.sessionID;
  if (typeof info?.id === "string") return info.id;
  const part = properties.part as { sessionID?: unknown } | undefined;
  return typeof part?.sessionID === "string" ? part.sessionID : null;
}

function resourcesForTool(tool: string, args: unknown, workspace: string): Record<string, unknown>[] {
  if (!isRecord(args)) return [];
  const normalizedTool = tool.toLowerCase().replace(/[^a-z0-9]/gu, "");

  if (normalizedTool === "webfetch") {
    const url = firstString(args, ["url"]);
    return url ? [{ resourceType: "webpage", accessType: "read", tool, url }] : [];
  }
  if (normalizedTool === "websearch") {
    const query = firstString(args, ["query"]);
    return query ? [{ resourceType: "web-search", accessType: "search", tool, query }] : [];
  }
  if (normalizedTool === "skill") {
    const name = firstString(args, ["name", "skill"]);
    return name ? [{ resourceType: "skill", accessType: "read", tool, name }] : [];
  }

  const directFileAccess: Record<string, "read" | "write"> = {
    read: "read", readfile: "read", view: "read", viewfile: "read", viewimage: "read",
    write: "write", writefile: "write", edit: "write", editfile: "write", multiedit: "write"
  };
  const accessType = directFileAccess[normalizedTool];
  if (accessType) {
    const path = firstString(args, ["filePath", "filepath", "path"]);
    return path ? [{ resourceType: "file", accessType, tool, path: workspacePath(path, workspace) }] : [];
  }

  if (normalizedTool === "applypatch" || normalizedTool === "patch") {
    const patch = firstString(args, ["patchText", "patch", "input"]);
    return patchPaths(patch).map(path => ({ resourceType: "file", accessType: "write", tool, path: workspacePath(path, workspace) }));
  }
  if (normalizedTool === "grep" || normalizedTool === "glob" || normalizedTool === "list" || normalizedTool === "listfiles") {
    const path = firstString(args, ["path", "directory"]) ?? ".";
    const pattern = firstString(args, ["pattern", "query", "include"]);
    return [{ resourceType: "directory", accessType: "search", tool, path: workspacePath(path, workspace), ...(pattern ? { pattern } : {}) }];
  }
  return [];
}

async function generatedCodeFor(resources: readonly Record<string, unknown>[], tool: string, workspace: string): Promise<Record<string, unknown>[]> {
  const generated: Record<string, unknown>[] = [];
  for (const resource of resources) {
    if (resource.resourceType !== "file" || resource.accessType !== "write" || typeof resource.path !== "string") continue;
    const absolute = isAbsolute(resource.path) ? resolve(resource.path) : resolve(workspace, resource.path);
    const local = relative(workspace, absolute);
    if (local.startsWith("..") || isAbsolute(local) || isSensitivePath(local)) continue;
    try {
      const content = await readFile(absolute);
      if (content.byteLength > 1024 * 1024 || content.includes(0)) continue;
      const code = new TextDecoder("utf-8", { fatal: true }).decode(content);
      generated.push({ path: workspacePath(absolute, workspace), code, operation: tool });
    } catch {
      // Deleted, binary, oversized, and unreadable files are intentionally not captured.
    }
  }
  return generated;
}

async function getGitIdentity(workspace: string | undefined): Promise<string> {
  const config = (key: string, global = false) =>
    execSync(`git config ${global ? "--global " : ""}user.${key}`, global ? {} : { cwd: workspace }).toString().trim();
  let name = "NOT_AVAILABLE", email = "NOT_AVAILABLE";
  try {
    const projectName = config("name");
    const projectEmail = config("email");
    if (projectName && projectEmail) {
      name = projectName;
      email = projectEmail;
    }
  } catch {}
  if (name === "NOT_AVAILABLE" || email === "NOT_AVAILABLE") {
    try {
      const globalName = config("name", true);
      const globalEmail = config("email", true);
      if (globalName) name = globalName;
      if (globalEmail) email = globalEmail;
    } catch {}
  }
  return name === "NOT_AVAILABLE" || email === "NOT_AVAILABLE" ? "NOT_AVAILABLE" : `${name} <${email}>`;
}

function isSensitivePath(path: string): boolean {
  const segments = path.replace(/\\/gu, "/").split("/");
  return segments.some(segment => segment === ".git" || segment === "node_modules" || segment === ".env" || segment.startsWith(".env."));
}

function workspacePath(path: string, workspace: string): string {
  const absolute = resolve(workspace, path);
  const local = relative(workspace, absolute);
  const selected = local !== "" && !local.startsWith("..") && !isAbsolute(local) ? local : absolute;
  return selected.replace(/\\/gu, "/") || ".";
}

function patchPaths(patch: string | undefined): string[] {
  if (!patch) return [];
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/gu)) {
    const marker = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/u.exec(line);
    const unified = /^(?:\+\+\+|---) (?:a\/|b\/)?(.+)$/u.exec(line);
    const path = (marker?.[1] ?? unified?.[1])?.trim();
    if (path && path !== "/dev/null") paths.add(path);
  }
  return [...paths];
}

function firstString(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
