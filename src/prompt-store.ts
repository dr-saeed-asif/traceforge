import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "mysql2/promise";

export interface CaptureEvent {
  readonly runId: string;
  readonly eventType: string;
  readonly actor?: { readonly name?: string };
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface PromptResult {
  readonly promptQuery: string;
  readonly agentName: string;
  readonly modelName: string;
  readonly result: string;
  readonly resources: readonly unknown[];
  readonly filePaths: readonly string[];
}

interface StoredEvent {
  readonly sequence: number;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface ActivePrompt {
  promptQuery: string;
  agentName: string;
  modelName: string;
  readonly resultParts: string[];
  readonly resources: unknown[];
  readonly events: StoredEvent[];
}

interface CaptureIndexEntry {
  readonly runId: string;
  readonly folder: string;
  readonly prompt: string;
  readonly updatedAt: string;
}

const terminalEvents = new Set(["AGENT_COMPLETED", "AGENT_FAILED", "SESSION_COMPLETED", "RUN_COMPLETED", "RUN_FAILED"]);

export class PromptStore {
  private readonly active = new Map<string, ActivePrompt>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly captureDir: string;

  public constructor(
    private readonly pool: Pick<Pool, "execute">,
    captureDir?: string
  ) {
    this.captureDir = captureDir ?? resolve(".", "opencode-activity-captures");
  }

  public ingest(event: CaptureEvent): Promise<void> {
    const previous = this.queues.get(event.runId) ?? Promise.resolve();
    const pending = previous.then(() => this.process(event));
    this.queues.set(event.runId, pending);
    return pending.finally(() => {
      if (this.queues.get(event.runId) === pending) this.queues.delete(event.runId);
    });
  }

  private async process(event: CaptureEvent): Promise<void> {
    const payload = event.payload ?? {};
    if (event.eventType === "PROMPT_SUBMITTED") {
      await this.finalize(event.runId);
      this.active.set(event.runId, {
        promptQuery: text(payload.content),
        agentName: text(payload.agent),
        modelName: text(payload.model),
        resultParts: [],
        resources: [],
        events: [{ sequence: 1, eventType: event.eventType, payload }]
      });
      return;
    }

    const prompt = this.active.get(event.runId);
    if (!prompt) return;
    const nextSequence = prompt.events.length + 1;
    prompt.events.push({ sequence: nextSequence, eventType: event.eventType, payload });
    if (event.eventType === "AGENT_STARTED") prompt.agentName = text(payload.agentName ?? payload.agent ?? event.actor?.name);
    if (event.eventType === "MODEL_REQUEST") prompt.modelName = text(payload.model ?? event.actor?.name);
    if (event.eventType === "MODEL_RESPONSE" && typeof payload.responseText === "string") {
      prompt.resultParts.push(payload.responseText);
      for (const resource of referencedWebpages(payload.responseText)) addResource(prompt, resource);
    }
    if (event.eventType === "RESOURCE_ACCESSED") addResource(prompt, payload);
    if (terminalEvents.has(event.eventType)) await this.finalize(event.runId);
  }

  private async finalize(runId: string): Promise<void> {
    const prompt = this.active.get(runId);
    if (!prompt) return;
    const result: PromptResult = {
      promptQuery: prompt.promptQuery,
      agentName: prompt.agentName,
      modelName: prompt.modelName,
      result: prompt.resultParts.join("\n") || "NOT_AVAILABLE",
      resources: prompt.resources,
      filePaths: filePaths(prompt.resources)
    };
    await this.pool.execute(
      "INSERT INTO prompt_results (`PromptQuery`,`AgentName`,`ModelName`,`Result`,`Resources`,`FilePaths`) VALUES (?,?,?,?,?,?)",
      [result.promptQuery, result.agentName, result.modelName, result.result, JSON.stringify(result.resources), JSON.stringify(result.filePaths)]
    );
    await this.writeCaptureFiles(runId, result, prompt.events);
    this.active.delete(runId);
  }

  private async writeCaptureFiles(runId: string, result: PromptResult, events: readonly StoredEvent[]): Promise<void> {
    await mkdir(this.captureDir, { recursive: true });
    const folder = `${runId}--0001--${slug(result.promptQuery)}`;
    const capturePath = resolve(this.captureDir, folder);
    const eventsPath = resolve(capturePath, "events");
    await mkdir(eventsPath, { recursive: true });

    const updatedAt = new Date().toISOString();
    const promptEventId = `prompt-${runId}`;
    const summary = {
      runId,
      sessionId: runId,
      promptEventId,
      status: "COMPLETED",
      eventCount: events.length,
      artifactCount: 0,
      updatedAt
    };
    const promptJson = {
      runId,
      prompt: result.promptQuery,
      agentName: result.agentName,
      modelName: result.modelName,
      result: result.result,
      filePaths: result.filePaths
    };
    const readme = [
      "# Prompt activity",
      "",
      `- Run: ${runId}`,
      `- Prompt event: ${promptEventId}`,
      `- Prompt: ${result.promptQuery}`,
      `- Prompt hash: ${sha256(result.promptQuery)}`,
      "",
      "Captured events are in `events/`."
    ].join("\n");

    const writes = [
      writeFile(resolve(capturePath, "README.md"), `${readme}\n`, "utf8"),
      writeFile(resolve(capturePath, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
      writeFile(resolve(capturePath, "prompt.json"), `${JSON.stringify(promptJson, null, 2)}\n`, "utf8"),
      writeFile(resolve(capturePath, "resources.json"), `${JSON.stringify({ resources: result.resources }, null, 2)}\n`, "utf8")
    ];

    for (const event of events) {
      const fileName = `${String(event.sequence).padStart(6, "0")}--${event.eventType}--${sha256(`${runId}:${event.sequence}:${event.eventType}`).slice(0, 36)}.json`;
      const eventJson = {
        runId,
        sequence: event.sequence,
        eventType: event.eventType,
        payload: event.payload
      };
      writes.push(writeFile(resolve(eventsPath, fileName), `${JSON.stringify(eventJson, null, 2)}\n`, "utf8"));
    }

    await Promise.all(writes);
    await this.updateIndex({ runId, folder, prompt: result.promptQuery, updatedAt });
  }

  private async updateIndex(entry: CaptureIndexEntry): Promise<void> {
    const indexPath = resolve(this.captureDir, "index.json");
    const entries = await this.readIndex(indexPath);
    const next = [entry, ...entries.filter((value) => value.folder !== entry.folder)];
    await writeFile(indexPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  private async readIndex(indexPath: string): Promise<readonly CaptureIndexEntry[]> {
    try {
      const text = await readFile(indexPath, "utf8");
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isCaptureIndexEntry) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

function isCaptureIndexEntry(value: unknown): value is CaptureIndexEntry {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { runId?: unknown }).runId === "string" &&
    typeof (value as { folder?: unknown }).folder === "string" &&
    typeof (value as { prompt?: unknown }).prompt === "string" &&
    typeof (value as { updatedAt?: unknown }).updatedAt === "string"
  );
}

function text(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : "NOT_AVAILABLE";
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 80) || "prompt";
}

function addResource(prompt: ActivePrompt, resource: Readonly<Record<string, unknown>>): void {
  const url = normalizedWebUrl(resource.url);
  if (url !== undefined) {
    const existingIndex = prompt.resources.findIndex((value) => isSameWebResource(value, url));
    if (existingIndex !== -1) {
      const existing = prompt.resources[existingIndex];
      if (isRecord(existing) && existing.accessType === "referenced" && resource.accessType !== "referenced") {
        prompt.resources[existingIndex] = resource;
      }
      return;
    }
  }
  if (!prompt.resources.some((value) => JSON.stringify(value) === JSON.stringify(resource))) prompt.resources.push(resource);
}

function referencedWebpages(text: string): Readonly<Record<string, unknown>>[] {
  const matches = text.match(/(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:[a-z0-9-]+\.)+(?:com|org|net|dev|edu|gov|info|tech|app|xyz|ai|io|me|pk|tv|co|uk)(?=\/|\b)(?:\/[^\s<>()]*)?/giu) ?? [];
  const resources: Readonly<Record<string, unknown>>[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const url = normalizedWebUrl(match.replace(/[\]}`'".,;:!?]+$/gu, ""));
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    resources.push({ resourceType: "webpage", accessType: "referenced", source: "model-response", url });
  }
  return resources;
}

function normalizedWebUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const candidate = /^https?:\/\//iu.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hostname = url.hostname.toLowerCase();
    return url.href;
  } catch {
    return undefined;
  }
}

function isSameWebResource(value: unknown, url: string): boolean {
  return isRecord(value) && normalizedWebUrl(value.url) === url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function filePaths(resources: readonly unknown[]): string[] {
  const paths = new Set<string>();
  for (const resource of resources) {
    if (!isRecord(resource) || (resource.resourceType !== "file" && resource.resourceType !== "directory")) continue;
    if (typeof resource.path !== "string" || resource.path.trim() === "") continue;
    paths.add(resource.path.trim().replace(/\\/gu, "/"));
  }
  return [...paths];
}
