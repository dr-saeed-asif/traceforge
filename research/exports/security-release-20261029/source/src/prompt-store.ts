import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  encryptGeneratedCode,
  type EncryptedGeneratedCode,
} from "./generated-code-crypto.js";
import {
  atomicWrite,
  EventJournal,
  type JournalEvent,
} from "./event-journal.js";
import type { PromptResultRepository } from "./persistence/prompt-result-repository.js";
import {
  CLAIM_VERIFICATION_POLICY_VERSION,
  mapCaptureEventToTraceEvent,
  type ClaimExtractor,
  type ExecutionStatus,
  VerificationApplicationService,
  type VerificationRepository,
} from "./modules/verification/index.js";

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
  finalResponseMessageId: string | null;
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

const terminalEvents = new Set([
  "AGENT_COMPLETED",
  "AGENT_FAILED",
  "SESSION_COMPLETED",
  "RUN_COMPLETED",
  "RUN_FAILED",
]);

export class PromptStore {
  private readonly active = new Map<string, ActivePrompt>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly captureDir: string;
  private readonly journal: EventJournal;
  private readonly verificationService:
    VerificationApplicationService | undefined;
  private readonly processed = new Map<string, number>();
  private initialization: Promise<void> | undefined;
  private indexQueue = Promise.resolve();

  public constructor(
    private readonly promptResults: PromptResultRepository,
    captureDir: string | undefined,
    private readonly generatedCodeKey: Buffer,
    private readonly verificationRepository?: VerificationRepository,
    claimExtractor?: ClaimExtractor,
  ) {
    this.captureDir = captureDir ?? resolve(".", "opencode-activity-captures");
    this.journal = new EventJournal(resolve(this.captureDir, ".journal"));
    this.verificationService = verificationRepository
      ? new VerificationApplicationService(
          verificationRepository,
          claimExtractor,
        )
      : undefined;
  }

  public initialize(): Promise<void> {
    return (this.initialization ??= (async () => {
      await this.journal.load();
      for (const runId of this.journal.runs.keys()) await this.drainRun(runId);
    })());
  }

  public async drain(): Promise<void> {
    await Promise.allSettled(this.queues.values());
  }

  public async ingest(event: CaptureEvent): Promise<void> {
    await this.initialize();
    const previous = this.queues.get(event.runId) ?? Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(async () => {
        await this.journal.append(event);
        await this.drainRun(event.runId);
      });
    this.queues.set(event.runId, pending);
    return pending.finally(() => {
      if (this.queues.get(event.runId) === pending)
        this.queues.delete(event.runId);
    });
  }

  private async drainRun(runId: string): Promise<void> {
    while (true) {
      const events = this.journal.runs.get(runId) ?? [];
      const index = this.processed.get(runId) ?? 0;
      if (index >= events.length) return;
      const event = events[index]!;
      const previous = this.active.get(runId);
      const snapshot = previous ? structuredClone(previous) : undefined;
      try {
        await this.process(event);
        if (terminalEvents.has(event.eventType)) {
          await this.journal.acknowledge(runId, index + 1);
          this.processed.set(runId, 0);
        } else if (event.eventType === "PROMPT_SUBMITTED" && previous) {
          // A new prompt implicitly finalizes the previous prompt in the same run.
          // Retain the new prompt event and acknowledge only the completed prefix.
          await this.journal.acknowledge(runId, index);
          this.processed.set(runId, 1);
        } else {
          this.processed.set(runId, index + 1);
        }
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
      const prompt: ActivePrompt = {
        promptId: event.promptId ?? sha256(`${event.runId}:${event.eventId}`),
        sessionId: event.sessionId ?? event.runId,
        projectName: event.projectName ?? null,
        projectPath: event.projectPath ?? null,
        responseParts: new Set(),
        status: "IN_PROGRESS",
        promptQuery: text(payload.content),
        agentName: text(payload.agent),
        modelName: text(payload.model),
        finalResponseMessageId: null,
        resultParts: [],
        resources: [],
        generatedCode: new Map(),
        events: [{ sequence: 1, eventType: event.eventType, payload }],
      };
      this.active.set(event.runId, prompt);
      await this.createVerificationSession(event, prompt);
      await this.persistTraceEvent(event, prompt);
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
    prompt.events.push({
      sequence: nextSequence,
      eventType: event.eventType,
      payload,
    });
    if (event.eventType === "AGENT_STARTED")
      prompt.agentName = text(
        payload.agentName ?? payload.agent ?? event.actor?.name,
      );
    if (event.eventType === "MODEL_REQUEST")
      prompt.modelName = text(payload.model ?? event.actor?.name);
    if (
      event.eventType === "MODEL_RESPONSE" &&
      typeof payload.responseText === "string"
    ) {
      // OpenCode may complete several assistant messages during one prompt. The
      // last completed assistant message is the user-visible final response;
      // earlier messages remain available in the immutable trace timeline.
      const messageId =
        typeof payload.messageId === "string"
          ? payload.messageId
          : event.eventId;
      if (messageId !== prompt.finalResponseMessageId) {
        prompt.finalResponseMessageId = messageId;
        prompt.resultParts.splice(0, prompt.resultParts.length);
      }
      prompt.resultParts.push(payload.responseText);
      for (const resource of referencedWebpages(payload.responseText))
        addResource(prompt, resource);
    }
    if (event.eventType === "RESOURCE_ACCESSED") addResource(prompt, payload);
    if (event.eventType === "GENERATED_CODE_CAPTURED")
      addGeneratedCode(prompt, payload);
    await this.persistTraceEvent(event, prompt);
    if (terminalEvents.has(event.eventType)) {
      prompt.status = event.eventType.endsWith("FAILED")
        ? "FAILED"
        : "COMPLETED";
      await this.finalize(event.runId, event.occurredAt);
    }
  }

  private async finalize(
    runId: string,
    completedAt = new Date().toISOString(),
  ): Promise<void> {
    const prompt = this.active.get(runId);
    if (!prompt) return;
    const generatedCode = [...prompt.generatedCode.values()];
    const gitUser =
      prompt.events.length > 0 &&
      prompt.events[0] &&
      typeof prompt.events[0].payload?.gitUser === "string" &&
      prompt.events[0].payload.gitUser.trim() !== ""
        ? prompt.events[0].payload.gitUser.trim()
        : "NOT_AVAILABLE";
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
      encryptedGeneratedCode: encryptGeneratedCode(
        generatedCode,
        this.generatedCodeKey,
      ),
      gitUser,
    };
    console.log("[TF:DB] final prompt record");
    console.table([
      { Field: "PromptQuery", Value: terminalValue(result.promptQuery) },
      { Field: "AgentName", Value: terminalValue(result.agentName) },
      { Field: "ModelName", Value: terminalValue(result.modelName) },
      { Field: "Result", Value: terminalValue(result.result) },
      { Field: "Resources", Value: terminalValue(result.resources) },
      { Field: "FilePaths", Value: terminalValue(result.filePaths) },
      { Field: "GeneratedCode", Value: terminalValue(result.generatedCode) },
      {
        Field: "EncryptedGeneratedCode",
        Value: terminalValue(result.encryptedGeneratedCode),
      },
      { Field: "GitUser", Value: terminalValue(result.gitUser) },
      { Field: "PromptId", Value: terminalValue(result.promptId) },
      { Field: "SessionId", Value: terminalValue(result.sessionId) },
      { Field: "RunId", Value: terminalValue(runId) },
      {
        Field: "ProjectName",
        Value: terminalValue(result.projectName ?? "NOT_AVAILABLE"),
      },
      {
        Field: "ProjectPath",
        Value: terminalValue(result.projectPath ?? "NOT_AVAILABLE"),
      },
      { Field: "Status", Value: terminalValue(result.status) },
    ]);
    const promptResultId = await this.promptResults.save({ ...result, runId });
    if (this.verificationRepository) {
      await this.verificationRepository.attachPromptResult(
        result.promptId,
        promptResultId,
      );
      if (this.verificationService) {
        try {
          await this.verificationService.verifyPrompt({
            promptId: result.promptId,
            externalSessionId: result.sessionId,
            runId,
            finalResponse: result.result,
            extractorModel: result.modelName,
            executionStatus: executionStatus(result.status),
            completedAt,
          });
        } catch (error) {
          // Verification failure must not discard the already durable legacy capture.
          console.warn("[TF:Verification] claim processing failed", error);
        }
      }
    }
    await this.writeCaptureFiles(runId, result, prompt.events);
    this.active.delete(runId);
  }

  private async createVerificationSession(
    event: JournalEvent,
    prompt: ActivePrompt,
  ): Promise<void> {
    if (!this.verificationRepository) return;
    await this.verificationRepository.createSession({
      promptId: prompt.promptId,
      externalSessionId: prompt.sessionId,
      runId: event.runId,
      promptResultId: null,
      projectName: prompt.projectName,
      projectPath: prompt.projectPath,
      agentName: prompt.agentName,
      modelName: prompt.modelName,
      policyVersion: CLAIM_VERIFICATION_POLICY_VERSION,
      startedAt: event.occurredAt,
    });
    // Query-level identity is created once; later lifecycle events are evidence.
  }

  private async persistTraceEvent(
    event: JournalEvent,
    prompt: ActivePrompt,
  ): Promise<void> {
    if (!this.verificationRepository) return;
    const mapping = mapCaptureEventToTraceEvent(event);
    if (!mapping) return;
    await this.verificationRepository.appendTraceEvent({
      promptId: prompt.promptId,
      externalSessionId: prompt.sessionId,
      runId: event.runId,
      sourceEventId: event.eventId,
      eventType: mapping.eventType,
      outcome: mapping.outcome,
      occurredAt: event.occurredAt,
      ...(mapping.target ? { target: mapping.target } : {}),
      metadata: mapping.metadata,
      ...(mapping.projections ? { projections: mapping.projections } : {}),
    });
    // appendTraceEvent is the durable source of truth. Verification reloads
    // the completed prompt timeline from the repository instead of retaining
    // a second in-memory evidence list.
  }

  private async writeCaptureFiles(
    runId: string,
    result: PromptResult,
    events: readonly StoredEvent[],
  ): Promise<void> {
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
      updatedAt,
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
      gitUser: result.gitUser,
    };
    const readme = [
      "# Prompt activity",
      "",
      `- Run: ${runId}`,
      `- Prompt event: ${promptEventId}`,
      `- Prompt: ${result.promptQuery}`,
      `- Prompt hash: ${sha256(result.promptQuery)}`,
      "",
      "Captured events are in `events/`.",
    ].join("\n");

    const writes = [
      writeFile(resolve(capturePath, "README.md"), `${readme}\n`, "utf8"),
      writeFile(
        resolve(capturePath, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        resolve(capturePath, "prompt.json"),
        `${JSON.stringify(promptJson, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        resolve(capturePath, "resources.json"),
        `${JSON.stringify({ resources: result.resources }, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        resolve(capturePath, "generated-code.json"),
        `${JSON.stringify({ generatedCode: result.generatedCode }, null, 2)}\n`,
        "utf8",
      ),
    ];

    for (const event of events) {
      const fileName = `${String(event.sequence).padStart(6, "0")}--${event.eventType.replace(/[^A-Z_]/gu, "_")}--${sha256(`${runId}:${event.sequence}:${event.eventType}`).slice(0, 36)}.json`;
      const eventJson = {
        runId,
        sequence: event.sequence,
        eventType: event.eventType,
        payload: event.payload,
      };
      writes.push(
        writeFile(
          resolve(eventsPath, fileName),
          `${JSON.stringify(eventJson, null, 2)}\n`,
          "utf8",
        ),
      );
    }

    await Promise.all(writes);
    await this.updateIndex({
      runId,
      folder,
      prompt: result.promptQuery,
      updatedAt,
    });
  }

  private updateIndex(entry: CaptureIndexEntry): Promise<void> {
    const pending = this.indexQueue
      .catch(() => {})
      .then(async () => {
        const indexPath = resolve(this.captureDir, "index.json");
        const entries = await this.readIndex(indexPath);
        const next = [
          entry,
          ...entries.filter((value) => value.folder !== entry.folder),
        ];
        await atomicWrite(indexPath, next);
      });
    this.indexQueue = pending;
    return pending;
  }

  private async readIndex(
    indexPath: string,
  ): Promise<readonly CaptureIndexEntry[]> {
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
    typeof (value as { updatedAt?: unknown }).updatedAt === "string",
  );
}

function text(value: unknown): string {
  return typeof value === "string" && value.trim() !== ""
    ? value
    : "NOT_AVAILABLE";
}

function executionStatus(value: string): ExecutionStatus {
  if (
    value === "COMPLETED" ||
    value === "FAILED" ||
    value === "INTERRUPTED" ||
    value === "IN_PROGRESS"
  )
    return value;
  return "FAILED";
}

function terminalValue(value: unknown, limit = 80): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const singleLine = (serialized ?? "NOT_AVAILABLE")
    .replace(/\s+/gu, " ")
    .trim();
  return singleLine.length <= limit
    ? singleLine
    : `${singleLine.slice(0, limit - 1)}…`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 80) || "prompt";
}

function addResource(
  prompt: ActivePrompt,
  resource: Readonly<Record<string, unknown>>,
): void {
  const url = normalizedWebUrl(resource.url);
  if (url !== undefined) {
    const existingIndex = prompt.resources.findIndex((value) =>
      isSameWebResource(value, url),
    );
    if (existingIndex !== -1) {
      const existing = prompt.resources[existingIndex];
      if (
        isRecord(existing) &&
        existing.accessType === "referenced" &&
        resource.accessType !== "referenced"
      ) {
        prompt.resources[existingIndex] = resource;
      }
      return;
    }
  }
  if (
    !prompt.resources.some(
      (value) => JSON.stringify(value) === JSON.stringify(resource),
    )
  )
    prompt.resources.push(resource);
}

function referencedWebpages(text: string): Readonly<Record<string, unknown>>[] {
  const matches =
    text.match(
      /(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:[a-z0-9-]+\.)+(?:com|org|net|dev|edu|gov|info|tech|app|xyz|ai|io|me|pk|tv|co|uk)(?=\/|\b)(?:\/[^\s<>()]*)?/giu,
    ) ?? [];
  const resources: Readonly<Record<string, unknown>>[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const url = normalizedWebUrl(match.replace(/[\]}`'".,;:!?]+$/gu, ""));
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    resources.push({
      resourceType: "webpage",
      accessType: "referenced",
      source: "model-response",
      url,
    });
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
    if (
      !isRecord(resource) ||
      (resource.resourceType !== "file" &&
        resource.resourceType !== "directory")
    )
      continue;
    if (typeof resource.path !== "string" || resource.path.trim() === "")
      continue;
    paths.add(resource.path.trim().replace(/\\/gu, "/"));
  }
  return [...paths];
}

function addGeneratedCode(
  prompt: ActivePrompt,
  payload: Readonly<Record<string, unknown>>,
): void {
  if (
    typeof payload.path !== "string" ||
    payload.path.trim() === "" ||
    typeof payload.code !== "string"
  )
    return;
  const path = payload.path.trim().replace(/\\/gu, "/");
  prompt.generatedCode.set(path, { path, code: payload.code });
}
