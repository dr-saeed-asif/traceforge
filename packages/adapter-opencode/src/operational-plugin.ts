import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";

interface Context {
  readonly taskId: string;
  readonly sessionId: string;
  readonly runId: string;
}

interface TextPart {
  readonly type: string;
  readonly text?: string;
  readonly time?: { readonly end?: number };
}

export const TraceForgePlugin: Plugin = async (input) => {
  const settings = loadSettings();
  const apiUrl = settings.TRACEFORGE_API_URL ?? "http://127.0.0.1:8080";
  const token = settings.TRACEFORGE_API_TOKEN;
  const workspace = input.directory || input.worktree;
  if (!token) {
    console.warn("[TraceForge] TRACEFORGE_API_TOKEN is unavailable; capture disabled");
    return {};
  }

  const contexts = new Map<string, Promise<Context>>();
  const contextFor = (sessionId: string) => {
    let context = contexts.get(sessionId);
    if (!context) {
      context = post<{ context: Context }>(apiUrl, token, "/api/v1/integrations/context", {
        externalSessionId: sessionId
      }).then(value => value.context);
      contexts.set(sessionId, context);
    }
    return context;
  };
  const capture = async (sessionId: string, eventType: string, payload: Record<string, unknown>, actor?: { name: string }) => {
    try {
      const context = await contextFor(sessionId);
      await post(apiUrl, token, "/api/v1/integrations/events", {
        ...context, eventType, payload, ...(actor ? { actor } : {})
      });
    } catch (error) {
      console.warn(`[TraceForge] ${eventType} capture failed`, error);
    }
  };

  return {
    "chat.message": async (input, output) => {
      const model = input.model ?? output.message.model;
      const agent = input.agent ?? output.message.agent ?? "OpenCode";
      const content = output.parts.filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
      // Standard chat hooks omit these fields, preserving Git's process-cwd lookup.
      const location = input as typeof input & { directory?: string; worktree?: string };
      const gitUser = await getGitIdentity(location.directory || location.worktree);
      await capture(input.sessionID, "PROMPT_SUBMITTED", { content, agent, model: model.modelID, gitUser });
      await capture(input.sessionID, "AGENT_STARTED", { agentName: agent }, { name: agent });
      await capture(input.sessionID, "MODEL_REQUEST", { model: model.modelID, provider: model.providerID }, { name: model.modelID });
    },
    event: async ({ event }) => {
      const properties = event.properties as Record<string, unknown>;
      const sessionId = sessionIdOf(properties);
      if (!sessionId) return;
      if (event.type === "session.idle") await capture(sessionId, "AGENT_COMPLETED", { status: "COMPLETED" });
      if (event.type === "session.deleted") await capture(sessionId, "SESSION_COMPLETED", { status: "COMPLETED" });
      if (event.type === "message.part.updated") {
        const part = properties.part as TextPart | undefined;
        if (part?.type === "text" && typeof part.text === "string" && part.time?.end !== undefined) {
          await capture(sessionId, "MODEL_RESPONSE", { responseText: part.text });
        }
      }
    },
    "tool.execute.after": async (input) => {
      const resources = resourcesForTool(input.tool, input.args, workspace);
      for (const resource of resources) await capture(input.sessionID, "RESOURCE_ACCESSED", resource);
      for (const generated of await generatedCodeFor(resources, input.tool, workspace)) {
        await capture(input.sessionID, "GENERATED_CODE_CAPTURED", generated);
      }
    }
  };
};

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
