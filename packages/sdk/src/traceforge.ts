import type { Clock, IdGenerator, StoredArtifact } from "@traceforge/application";
import type { ApprovalDecision, ApprovalTarget, GitCommit, RunGitAssociation } from "@traceforge/domain";
import type { TraceContext, TraceEventInput, TraceTransport } from "./contracts/trace-transport.js";
import { TraceSdkError } from "./errors/sdk-error.js";

export interface StartRunOptions {
  readonly task: string;
  readonly repository: string;
  readonly workspace: string;
  readonly developer: string;
  readonly agent: { readonly id: string; readonly name: string; readonly version: string };
  readonly environment?: Readonly<Record<string, string>>;
}

export interface ModelInvocationInput {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion?: string;
  readonly requestId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly response: Readonly<Record<string, unknown>>;
}

export interface ArtifactInput {
  readonly relativePath: string;
  readonly mimeType: string;
  readonly artifactType?: string;
  readonly operation?: "CREATED" | "MODIFIED";
  readonly content: string | Uint8Array;
}

export interface RecordedArtifact extends StoredArtifact {
  readonly artifactId: string;
  readonly relativePath: string;
}

export interface ApprovalInput {
  readonly target: ApprovalTarget;
  readonly reviewer: string;
  readonly decision: ApprovalDecision;
  readonly comment?: string;
}

export class Traceforge {
  public constructor(
    private readonly transport: TraceTransport,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  public startRun(options: StartRunOptions): TraceRun {
    if (options.task.trim() === "") throw new TraceSdkError("INVALID_ARGUMENT", "task is required");
    const context = { taskId: this.ids.generate(), sessionId: this.ids.generate(), runId: this.ids.generate() };
    return new TraceRun(this.transport, this.clock, this.ids, context, options);
  }
}

export class TraceRun {
  private readonly ready: Promise<void>;
  private tail: Promise<unknown>;
  private completionRequested = false;
  private completed = false;

  public constructor(
    private readonly transport: TraceTransport,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    public readonly context: TraceContext,
    private readonly options: StartRunOptions
  ) {
    this.ready = this.initialize();
    this.tail = this.ready;
  }

  public recordPrompt(content: string): Promise<void> {
    if (content.length === 0) return Promise.reject(new TraceSdkError("INVALID_ARGUMENT", "prompt content is required"));
    return this.schedule(async () => {
      await this.emit({
        eventType: "PROMPT_SUBMITTED", actor: { type: "human", id: this.options.developer },
        payload: { promptId: this.ids.generate(), content, reasoningAvailability: "NOT_AVAILABLE" }
      });
    });
  }

  public recordModelInvocation(input: ModelInvocationInput): Promise<void> {
    return this.schedule(async () => {
      const invocationId = this.ids.generate();
      const startedAt = this.clock.now().toISOString();
      await this.emit({
        eventType: "MODEL_REQUEST", actor: { type: "agent", id: this.options.agent.id, name: this.options.agent.name },
        provider: input.provider, ...(input.requestId === undefined ? {} : { providerEventId: input.requestId }),
        payload: { invocationId, model: input.model, ...(input.modelVersion === undefined ? {} : { modelVersion: input.modelVersion }) }
      });
      await this.emit({
        eventType: "MODEL_RESPONSE", actor: { type: "model", id: input.model, name: input.model },
        provider: input.provider, ...(input.requestId === undefined ? {} : { providerEventId: `${input.requestId}:response` }),
        payload: {
          invocationId, model: input.model, startedAt, completedAt: this.clock.now().toISOString(),
          response: input.response,
          ...(input.inputTokens === undefined ? {} : { inputTokens: input.inputTokens }),
          ...(input.outputTokens === undefined ? {} : { outputTokens: input.outputTokens })
        }
      });
    });
  }

  public recordToolCall<T>(
    toolName: string,
    input: Readonly<Record<string, unknown>>,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.schedule(async () => {
      const toolInvocationId = this.ids.generate();
      await this.emit({ eventType: "TOOL_STARTED", actor: { type: "tool", name: toolName }, payload: { toolInvocationId, toolName, input } });
      try {
        const output = await operation();
        await this.emit({
          eventType: "TOOL_COMPLETED", actor: { type: "tool", name: toolName },
          payload: { toolInvocationId, toolName, status: "COMPLETED", output: normalizeOutput(output) }
        });
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.emit({
          eventType: "TOOL_COMPLETED", actor: { type: "tool", name: toolName },
          payload: { toolInvocationId, toolName, status: "FAILED", error: message }
        });
        await this.emit({ eventType: "ERROR", actor: { type: "system", name: "traceforge-sdk" }, payload: { operation: "tool", toolName, message } });
        throw error;
      }
    });
  }

  public recordArtifact(input: ArtifactInput): Promise<RecordedArtifact> {
    return this.schedule(async () => {
      const content = typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content;
      const stored = await this.transport.storeArtifact(content);
      const artifactId = this.ids.generate();
      const operation = input.operation ?? "CREATED";
      await this.emit({
        eventType: operation === "CREATED" ? "FILE_CREATED" : "FILE_MODIFIED",
        actor: { type: "agent", id: this.options.agent.id, name: this.options.agent.name },
        payload: { relativePath: input.relativePath, operation, contentHash: stored.contentHash, size: stored.size }
      });
      await this.emit({
        eventType: "ARTIFACT_CREATED", actor: { type: "agent", id: this.options.agent.id, name: this.options.agent.name },
        payload: {
          artifactId, artifactType: input.artifactType ?? "source", relativePath: input.relativePath,
          mimeType: input.mimeType, size: stored.size, contentHash: stored.contentHash,
          hashAlgorithm: "sha256", storageReference: stored.storageReference
        }
      });
      return { ...stored, artifactId, relativePath: input.relativePath };
    });
  }

  public recordApproval(input: ApprovalInput): Promise<string> {
    if (input.reviewer.trim() === "") return Promise.reject(new TraceSdkError("INVALID_ARGUMENT", "reviewer is required"));
    const hasArtifact = input.target.artifactId !== undefined;
    const hasManifest = input.target.manifestId !== undefined;
    if (hasArtifact === hasManifest) return Promise.reject(new TraceSdkError("INVALID_ARGUMENT", "approval must target exactly one artifact or manifest"));
    return this.schedule(async () => {
      const approvalId = this.ids.generate();
      await this.emit({
        eventType: input.decision === "APPROVED" ? "HUMAN_APPROVAL" : "HUMAN_REJECTION",
        actor: { type: "human", id: input.reviewer },
        payload: {
          approvalId, ...input.target, reviewer: input.reviewer, decision: input.decision,
          timestamp: this.clock.now().toISOString(),
          ...(input.comment === undefined ? {} : { comment: input.comment })
        }
      });
      return approvalId;
    });
  }

  public recordGitCommit(commit: GitCommit, association: RunGitAssociation): Promise<void> {
    if (association.runId !== this.context.runId || association.commitId !== commit.commitId) {
      return Promise.reject(new TraceSdkError("INVALID_ARGUMENT", "Git association does not match this run and commit"));
    }
    return this.schedule(async () => {
      await this.emit({
        eventType: "GIT_COMMIT_CREATED",
        actor: { type: "human", id: commit.author, name: commit.author },
        payload: {
          repository: commit.repository, branch: commit.branch, baseCommit: commit.baseCommit,
          commitId: commit.commitId, author: commit.author, authorEmail: commit.authorEmail,
          timestamp: commit.timestamp, changedFiles: commit.changedFiles,
          association: {
            evidence: association.evidence,
            matchedArtifactIds: association.matchedArtifactIds,
            unmatchedArtifactIds: association.unmatchedArtifactIds
          }
        }
      });
    });
  }

  public complete(): Promise<void> {
    if (this.completionRequested) return Promise.reject(new TraceSdkError("RUN_ALREADY_COMPLETED", "Run completion was already requested"));
    this.completionRequested = true;
    const completion = this.tail.then(async () => {
      await this.emit({ eventType: "AGENT_COMPLETED", actor: { type: "agent", id: this.options.agent.id, name: this.options.agent.name }, payload: { status: "COMPLETED" } });
      await this.emit({ eventType: "RUN_COMPLETED", actor: { type: "system", name: "traceforge-sdk" }, payload: { status: "COMPLETED" } });
      await this.emit({ eventType: "SESSION_COMPLETED", actor: { type: "human", id: this.options.developer }, payload: { status: "COMPLETED" } });
      this.completed = true;
    });
    this.tail = completion;
    return completion;
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    if (this.completionRequested || this.completed) return Promise.reject(new TraceSdkError("RUN_COMPLETED", "Cannot record activity after completion"));
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async initialize(): Promise<void> {
    const createdAt = this.clock.now().toISOString();
    await this.emit({
      eventType: "TASK_CREATED", actor: { type: "human", id: this.options.developer },
      payload: { title: this.options.task, repository: this.options.repository, workspace: this.options.workspace, createdAt }
    });
    await this.emit({
      eventType: "SESSION_STARTED", actor: { type: "human", id: this.options.developer },
      payload: { developer: this.options.developer, environment: this.options.environment ?? {}, startedAt: createdAt }
    });
    await this.emit({
      eventType: "AGENT_STARTED", actor: { type: "agent", id: this.options.agent.id, name: this.options.agent.name },
      payload: { agentId: this.options.agent.id, agentName: this.options.agent.name, agentVersion: this.options.agent.version, startedAt: createdAt }
    });
  }

  private emit(input: TraceEventInput) { return this.transport.emit(this.context, input); }
}

function normalizeOutput(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Uint8Array) return { byteLength: value.byteLength };
  if (value instanceof Error) return { name: value.name, message: value.message };
  return value;
}
