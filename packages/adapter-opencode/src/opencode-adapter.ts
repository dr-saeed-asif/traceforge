import type {
  AdapterRunContext,
  AgentAdapter,
  AgentEventHandler,
  NormalizedAgentEvent,
  Unsubscribe
} from "@traceforge/adapter-contracts";
import { sha256 } from "@traceforge/crypto";
import { OPENCODE_CAPABILITIES } from "./capabilities.js";
import type {
  OpenCodeAssistantMessage,
  OpenCodeEvent,
  OpenCodeFileDiff,
  OpenCodePart,
  OpenCodeUserMessage
} from "./opencode-types.js";

export interface OpenCodeAdapterConfig {
  readonly contextForSession: (openCodeSessionId: string) => Promise<AdapterRunContext | null>;
  readonly defaultContext?: AdapterRunContext;
  readonly now?: () => Date;
}

export interface ChatMessageHookInput {
  readonly sessionID: string;
  readonly agent?: string;
  readonly model?: { readonly providerID: string; readonly modelID: string };
  readonly messageID?: string;
}

export interface ChatMessageHookOutput {
  readonly message: OpenCodeUserMessage;
  readonly parts: readonly OpenCodePart[];
}

export interface ToolBeforeInput { readonly tool: string; readonly sessionID: string; readonly callID: string }
export interface ToolAfterInput extends ToolBeforeInput { readonly args: unknown }
export interface ToolAfterOutput { readonly title: string; readonly output: string; readonly metadata: unknown }

export class OpenCodeAdapter implements AgentAdapter<OpenCodeAdapterConfig> {
  public readonly name = "opencode";
  public readonly version = "1.18.21";
  public readonly capabilities = OPENCODE_CAPABILITIES;
  private readonly handlers = new Set<AgentEventHandler>();
  private readonly assistantMessages = new Map<string, OpenCodeAssistantMessage>();
  private config?: OpenCodeAdapterConfig;
  private running = false;

  public async initialize(config: OpenCodeAdapterConfig): Promise<void> { this.config = config; }
  public async start(): Promise<void> {
    if (this.config === undefined) throw new Error("OpenCode adapter must be initialized before start");
    this.running = true;
  }
  public async stop(): Promise<void> { this.running = false; this.assistantMessages.clear(); }
  public onEvent(handler: AgentEventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  public async handleChatMessage(input: ChatMessageHookInput, output: ChatMessageHookOutput): Promise<void> {
    const context = await this.context(input.sessionID);
    if (context === null) return;
    const content = output.parts.filter(isTextPart).map((part) => part.text).join("\n");
    const agent = input.agent ?? output.message.agent;
    const model = input.model ?? output.message.model;
    await this.publish(context, {
      eventType: "PROMPT_SUBMITTED", providerEventId: `${output.message.id}:prompt`, evidence: "OBSERVED",
      actor: { type: "human", name: "opencode-user" },
      provider: model.providerID,
      occurredAt: epoch(output.message.time.created),
      payload: {
        promptId: output.message.id, content, agent, provider: model.providerID,
        model: model.modelID, reasoningAvailability: "NOT_AVAILABLE"
      }
    });
    await this.publish(context, {
      eventType: "AGENT_STARTED", providerEventId: `${output.message.id}:agent`, evidence: "OBSERVED",
      actor: { type: "agent", id: agent, name: agent },
      payload: { agentId: agent, agentName: agent, agentVersion: "not_available", openCodeMessageId: output.message.id }
    });
    await this.publish(context, {
      eventType: "MODEL_REQUEST", providerEventId: `${output.message.id}:model-request`, evidence: "OBSERVED",
      actor: { type: "model", id: model.modelID, name: model.modelID }, provider: model.providerID,
      payload: { invocationId: output.message.id, provider: model.providerID, model: model.modelID, requestId: "not_available" }
    });
  }

  public async handleToolBefore(input: ToolBeforeInput, args: unknown): Promise<void> {
    const context = await this.context(input.sessionID);
    if (context === null) return;
    await this.publish(context, {
      eventType: "TOOL_STARTED", providerEventId: `${input.callID}:tool-start`, evidence: "OBSERVED",
      actor: { type: "tool", id: input.tool, name: input.tool },
      payload: { toolInvocationId: input.callID, toolName: input.tool, input: jsonObject(args) }
    });
    if (input.tool === "bash") {
      const values = jsonObject(args);
      await this.publish(context, {
        eventType: "TERMINAL_COMMAND_STARTED", providerEventId: `${input.callID}:terminal-start`, evidence: "OBSERVED",
        actor: { type: "tool", id: "bash", name: "bash" },
        payload: {
          commandExecutionId: input.callID,
          command: typeof values.command === "string" ? values.command : "not_available",
          workingDirectory: typeof values.workdir === "string" ? values.workdir : "not_available"
        }
      });
    }
  }

  public async handleToolAfter(input: ToolAfterInput, output: ToolAfterOutput): Promise<void> {
    const context = await this.context(input.sessionID);
    if (context === null) return;
    await this.publish(context, {
      eventType: "TOOL_COMPLETED", providerEventId: `${input.callID}:tool-complete`, evidence: "OBSERVED",
      actor: { type: "tool", id: input.tool, name: input.tool },
      payload: {
        toolInvocationId: input.callID, toolName: input.tool, status: "COMPLETED",
        input: jsonObject(input.args), title: output.title, output: output.output,
        metadata: jsonObject(output.metadata)
      }
    });
    await this.publishToolSpecialization(context, input, output);
  }

  public async handleEvent(event: OpenCodeEvent): Promise<void> {
    if (!this.running) return;
    const properties = event.properties as Record<string, unknown>;
    if (event.type === "session.created" || event.type === "session.deleted") {
      const info = jsonObject(properties.info);
      const sessionID = typeof info.id === "string" ? info.id : "";
      const context = await this.context(sessionID);
      if (context !== null) await this.publish(context, {
        eventType: event.type === "session.created" ? "SESSION_STARTED" : "SESSION_COMPLETED",
        providerEventId: `${sessionID}:${event.type}`, evidence: "OBSERVED",
        actor: { type: "system", id: "opencode", name: "OpenCode" }, payload: { openCodeSessionId: sessionID }
      });
      return;
    }
    const sessionID = sessionIdOf(event, properties);
    const context = sessionID === null ? this.config?.defaultContext ?? null : await this.context(sessionID);
    if (context === null) return;

    if (event.type === "session.idle") {
      await this.publish(context, {
        eventType: "AGENT_COMPLETED", providerEventId: `${sessionID}:idle:${this.now().getTime()}`, evidence: "OBSERVED",
        actor: { type: "agent", id: "opencode", name: "OpenCode" }, payload: { status: "IDLE" }
      });
    } else if (event.type === "session.error") {
      await this.publish(context, {
        eventType: "ERROR", providerEventId: `${sessionID}:error:${this.now().getTime()}`, evidence: "OBSERVED",
        actor: { type: "system", id: "opencode", name: "OpenCode" }, payload: { error: safeUnknown(properties.error) }
      });
    } else if (event.type === "session.diff") {
      for (const diff of (properties.diff as readonly OpenCodeFileDiff[] | undefined) ?? []) await this.publishDiff(context, sessionID ?? "unknown", diff);
    } else if (event.type === "message.updated") {
      await this.publishMessage(context, properties.info as OpenCodeUserMessage | OpenCodeAssistantMessage);
    } else if (event.type === "message.part.updated") {
      await this.publishPart(context, properties.part as OpenCodePart);
    } else if (event.type === "file.edited" || event.type === "file.watcher.updated") {
      const file = String(properties.file ?? "not_available");
      const watcherEvent = properties.event;
      const eventType = watcherEvent === "add" ? "FILE_CREATED" : watcherEvent === "unlink" ? "FILE_DELETED" : "FILE_MODIFIED";
      await this.publish(context, {
        eventType, providerEventId: `${event.type}:${file}:${this.now().getTime()}`, evidence: "OBSERVED",
        actor: { type: "system", id: "opencode-file-observer", name: "OpenCode file observer" },
        payload: { relativePath: file, operation: watcherEvent ?? "edited", attribution: "not_available" }
      });
    }
  }

  private async publishMessage(context: AdapterRunContext, message: OpenCodeUserMessage | OpenCodeAssistantMessage): Promise<void> {
    if (message.role !== "assistant") return;
    this.assistantMessages.set(message.id, message);
    if (message.time.completed === undefined) return;
    await this.publish(context, {
      eventType: "MODEL_RESPONSE", providerEventId: `${message.id}:model-response`, evidence: "OBSERVED",
      actor: { type: "model", id: message.modelID, name: message.modelID }, provider: message.providerID,
      occurredAt: epoch(message.time.completed),
      payload: {
        invocationId: message.parentID ?? message.id, messageId: message.id,
        provider: message.providerID, model: message.modelID, mode: message.mode,
        inputTokens: message.tokens.input, outputTokens: message.tokens.output,
        reasoningTokens: message.tokens.reasoning, cacheReadTokens: message.tokens.cache.read,
        cacheWriteTokens: message.tokens.cache.write, cost: message.cost,
        responseContent: "not_available", hiddenReasoning: "not_available",
        ...(message.error === undefined ? {} : { error: safeUnknown(message.error) })
      }
    });
  }

  private async publishPart(context: AdapterRunContext, part: OpenCodePart): Promise<void> {
    if ((part.type !== "text" && part.type !== "reasoning") || !hasCompletedTime(part)) return;
    const message = this.assistantMessages.get(part.messageID);
    const text = String(part.text);
    await this.publish(context, {
      eventType: "MODEL_RESPONSE", providerEventId: `${part.id}:completed`, evidence: "OBSERVED",
      actor: { type: "model", ...(message === undefined ? { id: "not_available" } : { id: message.modelID, name: message.modelID }) },
      ...(message === undefined ? {} : { provider: message.providerID }),
      occurredAt: epoch(part.time.end),
      payload: part.type === "text"
        ? { messageId: part.messageID, partId: part.id, responseText: text, responsePart: true, hiddenReasoning: "not_available" }
        : { messageId: part.messageID, partId: part.id, visibleReasoningSummary: text, reasoningAvailability: "USER_VISIBLE_SUMMARY" }
    });
  }

  private async publishDiff(context: AdapterRunContext, sessionID: string, diff: OpenCodeFileDiff): Promise<void> {
    const operation = diff.before === "" && diff.after !== "" ? "CREATED" : diff.before !== "" && diff.after === "" ? "DELETED" : "MODIFIED";
    const beforeHash = diff.before === "" ? null : sha256(diff.before);
    const afterHash = diff.after === "" ? null : sha256(diff.after);
    const diffHash = sha256(`${diff.before}\0${diff.after}`);
    await this.publish(context, {
      eventType: operation === "CREATED" ? "FILE_CREATED" : operation === "DELETED" ? "FILE_DELETED" : "FILE_MODIFIED",
      providerEventId: `${sessionID}:diff:${diff.file}:${diffHash}:file`, evidence: "OBSERVED",
      actor: { type: "system", id: "opencode-session-diff", name: "OpenCode session diff" },
      payload: { relativePath: diff.file, operation, beforeHash, afterHash, diffHash }
    });
    await this.publish(context, {
      eventType: "CODE_DIFF_GENERATED", providerEventId: `${sessionID}:diff:${diff.file}:${diffHash}:diff`, evidence: "OBSERVED",
      actor: { type: "system", id: "opencode-session-diff", name: "OpenCode session diff" },
      payload: { relativePath: diff.file, beforeHash, afterHash, diffHash, additions: diff.additions, deletions: diff.deletions }
    });
  }

  private async publishToolSpecialization(context: AdapterRunContext, input: ToolAfterInput, output: ToolAfterOutput): Promise<void> {
    const args = jsonObject(input.args);
    if (input.tool === "bash") {
      const metadata = jsonObject(output.metadata);
      await this.publish(context, {
        eventType: "TERMINAL_COMMAND_COMPLETED", providerEventId: `${input.callID}:terminal-complete`, evidence: "OBSERVED",
        actor: { type: "tool", id: "bash", name: "bash" },
        payload: { commandExecutionId: input.callID, command: args.command ?? "not_available", output: output.output, exitCode: metadata.exit ?? "not_available" }
      });
    } else if (input.tool === "read") {
      await this.publish(context, {
        eventType: "FILE_READ", providerEventId: `${input.callID}:file-read`, evidence: "OBSERVED",
        actor: { type: "tool", id: "read", name: "read" }, payload: { relativePath: pathFrom(args), content: "not_captured" }
      });
    } else if (input.tool === "edit" || input.tool === "write") {
      await this.publish(context, {
        eventType: "FILE_MODIFIED", providerEventId: `${input.callID}:file-write`, evidence: "OBSERVED",
        actor: { type: "tool", id: input.tool, name: input.tool },
        payload: { relativePath: pathFrom(args), operation: input.tool === "edit" ? "MODIFIED" : "CREATE_OR_OVERWRITE" }
      });
    } else if (input.tool === "webfetch" && typeof args.url === "string") {
      await this.publish(context, {
        eventType: "RESOURCE_ACCESSED", providerEventId: `${input.callID}:resource`, evidence: "OBSERVED",
        actor: { type: "tool", id: "webfetch", name: "webfetch" },
        payload: { resourceType: "webpage", url: args.url, toolName: "webfetch", verification: "OBSERVED" }
      });
    }
  }

  private async context(sessionID: string): Promise<AdapterRunContext | null> {
    if (!this.running || this.config === undefined) return null;
    return this.config.contextForSession(sessionID);
  }
  private now(): Date { return this.config?.now?.() ?? new Date(); }
  private async publish(context: AdapterRunContext, event: Omit<NormalizedAgentEvent, keyof AdapterRunContext>): Promise<void> {
    if (!this.running) return;
    const normalized: NormalizedAgentEvent = { ...context, ...event };
    await Promise.all([...this.handlers].map((handler) => handler(normalized)));
  }
}

function epoch(value: number): string { return new Date(value).toISOString(); }
function isTextPart(part: OpenCodePart): part is Extract<OpenCodePart, { type: "text" }> { return part.type === "text"; }
function hasCompletedTime(part: OpenCodePart): part is OpenCodePart & { readonly text: string; readonly time: { readonly end: number } } {
  const time = (part as { time?: { end?: number } }).time;
  return time?.end !== undefined;
}
function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function safeUnknown(value: unknown): unknown {
  if (value === undefined) return "not_available";
  try { return JSON.parse(JSON.stringify(value)) as unknown; } catch { return String(value); }
}
function sessionIdOf(event: OpenCodeEvent, properties: Record<string, unknown>): string | null {
  if (typeof properties.sessionID === "string") return properties.sessionID;
  const info = jsonObject(properties.info);
  if (typeof info.sessionID === "string") return info.sessionID;
  const part = jsonObject(properties.part);
  return typeof part.sessionID === "string" ? part.sessionID : null;
}
function pathFrom(args: Record<string, unknown>): string {
  const value = args.filePath ?? args.path ?? args.filename;
  return typeof value === "string" ? value : "not_available";
}
