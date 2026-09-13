import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "mysql2/promise";
import { encryptGeneratedCode, type EncryptedGeneratedCode } from "./generated-code-crypto.js";
import { atomicWrite, EventJournal, type JournalEvent } from "./event-journal.js";

export interface CaptureEvent {
  readonly eventId?: string;
  readonly occurredAt?: string;
  readonly promptId?: string;
  readonly sessionId?: string;
  readonly projectName?: string;
  readonly projectPath?: string;
  readonly runId: string;
  readonly eventType: string;
  readonly actor?: { readonly name?: string };
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface PromptResult {
  readonly promptId: string;
  readonly sessionId: string;
  readonly projectName: string | null;
  readonly projectPath: string | null;
  readonly status: string;
  readonly promptQuery: string;
  readonly agentName: string;
  readonly modelName: string;
  readonly result: string;
  readonly resources: readonly unknown[];
  readonly filePaths: readonly string[];
  readonly generatedCode: readonly GeneratedCode[];
  readonly encryptedGeneratedCode: EncryptedGeneratedCode;
  readonly gitUser: string;
}

interface GeneratedCode {
  readonly path: string;
  readonly code: string;
}

interface StoredEvent {
  readonly sequence: number;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface ActivePrompt {
  readonly promptId: string;
  readonly sessionId: string;
  readonly projectName: string | null;
  readonly projectPath: string | null;
  readonly responseParts: Set<string>;
  status: string;
  promptQuery: string;
  agentName: string;
  modelName: string;
  readonly resultParts: string[];
  readonly resources: unknown[];
  readonly generatedCode: Map<string, GeneratedCode>;
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
  private readonly journal: EventJournal;
  private readonly processed = new Map<string, number>();
  private initialization: Promise<void> | undefined;
  private indexQueue = Promise.resolve();

  public constructor(
    private readonly pool: Pick<Pool, "execute">,
    captureDir: string | undefined,
    private readonly generatedCodeKey: Buffer
  ) {
    this.captureDir = captureDir ?? resolve(".", "opencode-activity-captures");
    this.journal = new EventJournal(resolve(this.captureDir, ".journal"));
  }

  public initialize(): Promise<void> {
    return this.initialization ??= (async () => {
      await this.journal.load();
      for (const runId of this.journal.runs.keys()) await this.drainRun(runId);
    })();
  }

  public async drain(): Promise<void> {
    await Promise.allSettled(this.queues.values());
  }

  public async ingest(event: CaptureEvent): Promise<void> {
    await this.initialize();
    const previous = this.queues.get(event.runId) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      await this.journal.append(event);
      await this.drainRun(event.runId);
    });
    this.queues.set(event.runId, pending);
    return pending.finally(() => {
      if (this.queues.get(event.runId) === pending) this.queues.delete(event.runId);
    });
  }

  private async drainRun(runId: string): Promise<void> {
    const events = this.journal.runs.get(runId) ?? [];
    while ((this.processed.get(runId) ?? 0) < events.length) {
      const index = this.processed.get(runId) ?? 0;
      const previous = this.active.get(runId);
      const snapshot = previous ? structuredClone(previous) : undefined;
      try {
        await this.process(events[index]!);
        this.processed.set(runId, index + 1);
      } catch (error) {
        if (snapshot) this.active.set(runId, snapshot);
        else this.active.delete(runId);
        throw error;
      }
    }
  }

  private async process(event: JournalEvent): Promise<void> {
    const payload = event.payload ?? {};
    if (event.eventType === "PROMPT_SUBMITTED") {
      const previous = this.active.get(event.runId);
      if (previous) previous.status = "INTERRUPTED";
      await this.finalize(event.runId);
      this.active.set(event.runId, {
        promptId: event.promptId ?? sha256(`${event.runId}:${event.eventId}`),
        sessionId: event.sessionId ?? event.runId,
        projectName: event.projectName ?? null,
        projectPath: event.projectPath ?? null,
        responseParts: new Set(),
        status: "IN_PROGRESS",
        promptQuery: text(payload.content),
        agentName: text(payload.agent),
        modelName: text(payload.model),
        resultParts: [],
        resources: [],
        generatedCode: new Map(),
        events: [{ sequence: 1, eventType: event.eventType, payload }]
      });
      return;
    }

    const prompt = this.active.get(event.runId);
    if (!prompt) return;
    if (event.promptId && event.promptId !== prompt.promptId) return;
    if (event.eventType === "MODEL_RESPONSE") {
      if (payload.role !== undefined && payload.role !== "assistant") return;
      if (typeof payload.partId === "string") {
        const key = `${String(payload.messageId)}:${payload.partId}`;
        if (prompt.responseParts.has(key)) return;
        prompt.responseParts.add(key);
      }
    }
    const nextSequence = prompt.events.length + 1;
    prompt.events.push({ sequence: nextSequence, eventType: event.eventType, payload });
    if (event.eventType === "AGENT_STARTED") prompt.agentName = text(payload.agentName ?? payload.agent ?? event.actor?.name);
    if (event.eventType === "MODEL_REQUEST") prompt.modelName = text(payload.model ?? event.actor?.name);
    if (event.eventType === "MODEL_RESPONSE" && typeof payload.responseText === "string") {
      prompt.resultParts.push(payload.responseText);
      for (const resource of referencedWebpages(payload.responseText)) addResource(prompt, resource);
    }
    if (event.eventType === "RESOURCE_ACCESSED") addResource(prompt, payload);
    if (event.eventType === "GENERATED_CODE_CAPTURED") addGeneratedCode(prompt, payload);
    if (terminalEvents.has(event.eventType)) {
      prompt.status = event.eventType.endsWith("FAILED") ? "FAILED" : "COMPLETED";
      await this.finalize(event.runId);
    }
  }

  private async finalize(runId: string): Promise<void> {
    const prompt = this.active.get(runId);
    if (!prompt) return;
    const generatedCode = [...prompt.generatedCode.values()];
    const gitUser = prompt.events.length > 0 && prompt.events[0] && typeof prompt.events[0].payload?.gitUser === "string" && prompt.events[0].payload.gitUser.trim() !== "" ? prompt.events[0].payload.gitUser.trim() : "NOT_AVAILABLE";
    const result: PromptResult = {
      promptId: prompt.promptId,
      sessionId: prompt.sessionId,
      projectName: prompt.projectName,
      projectPath: prompt.projectPath,
      status: prompt.status,
      promptQuery: prompt.promptQuery,
      agentName: prompt.agentName,
      modelName: prompt.modelName,
      result: prompt.resultParts.join("\n") || "NOT_AVAILABLE",
      resources: prompt.resources,
      filePaths: filePaths(prompt.resources),
      generatedCode,
      encryptedGeneratedCode: encryptGeneratedCode(generatedCode, this.generatedCodeKey),
      gitUser
    };
    await this.pool.execute(
      "INSERT INTO prompt_results (`PromptQuery`,`AgentName`,`ModelName`,`Result`,`Resources`,`FilePaths`,`GeneratedCode`,`EncryptedGeneratedCode`,`GitUser`,`PromptId`,`SessionId`,`RunId`,`ProjectName`,`ProjectPath`,`Status`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `PromptId` = `PromptId`",
      [result.promptQuery, result.agentName, result.modelName, result.result, JSON.stringify(result.resources), JSON.stringify(result.filePaths), JSON.stringify(result.generatedCode), JSON.stringify(result.encryptedGeneratedCode), result.gitUser, result.promptId, result.sessionId, runId, result.projectName, result.projectPath, result.status]
    );
    await this.writeCaptureFiles(runId, result, prompt.events);
    this.active.delete(runId);
  }

  private async writeCaptureFiles(runId: string, result: PromptResult, events: readonly StoredEvent[]): Promise<void> {
    await mkdir(this.captureDir, { recursive: true });
    const folder = `${slug(runId)}--${sha256(result.promptId).slice(0, 24)}--${slug(result.promptQuery)}`;
    const capturePath = resolve(this.captureDir, folder);
    const eventsPath = resolve(capturePath, "events");
    await mkdir(eventsPath, { recursive: true });

    const updatedAt = new Date().toISOString();
    const promptEventId = result.promptId;
    const summary = {
      runId,
      sessionId: result.sessionId,
      projectName: result.projectName,
      projectPath: result.projectPath,
      promptEventId,
      status: result.status,
      eventCount: events.length,
      artifactCount: result.generatedCode.length,
      updatedAt
    };
    const promptJson = {
      runId,
      promptId: result.promptId,
      sessionId: result.sessionId,
      projectName: result.projectName,
      projectPath: result.projectPath,
      prompt: result.promptQuery,
      agentName: result.agentName,
      modelName: result.modelName,
      result: result.result,
      filePaths: result.filePaths,
      generatedFiles: result.generatedCode.map((entry) => entry.path),
      gitUser: result.gitUser
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
      writeFile(resolve(capturePath, "resources.json"), `${JSON.stringify({ resources: result.resources }, null, 2)}\n`, "utf8"),
      writeFile(resolve(capturePath, "generated-code.json"), `${JSON.stringify({ generatedCode: result.generatedCode }, null, 2)}\n`, "utf8")
    ];

    for (const event of events) {
      const fileName = `${String(event.sequence).padStart(6, "0")}--${event.eventType.replace(/[^A-Z_]/gu, "_")}--${sha256(`${runId}:${event.sequence}:${event.eventType}`).slice(0, 36)}.json`;
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

  private updateIndex(entry: CaptureIndexEntry): Promise<void> {
    const pending = this.indexQueue.catch(() => {}).then(async () => {
      const indexPath = resolve(this.captureDir, "index.json");
      const entries = await this.readIndex(indexPath);
      const next = [entry, ...entries.filter((value) => value.folder !== entry.folder)];
      await atomicWrite(indexPath, next);
    });
    this.indexQueue = pending;
    return pending;
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

function addGeneratedCode(prompt: ActivePrompt, payload: Readonly<Record<string, unknown>>): void {
  if (typeof payload.path !== "string" || payload.path.trim() === "" || typeof payload.code !== "string") return;
  const path = payload.path.trim().replace(/\\/gu, "/");
  prompt.generatedCode.set(path, { path, code: payload.code });
}
