import type {
  AgentAdapter,
  AgentEventHandler,
  NormalizedAgentEvent,
  Unsubscribe
} from "@traceforge/adapter-contracts";
import type { Clock, IdGenerator } from "@traceforge/application";
import { OLLAMA_CAPABILITIES } from "./capabilities.js";
import type {
  OllamaChatRequest,
  OllamaGatewayResponse,
  OllamaGenerateRequest,
  OllamaInvocation,
  OllamaToolCall
} from "./types.js";

export interface OllamaGatewayConfig {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly maxCaptureBytes?: number;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

interface ResponseAggregate {
  model?: string;
  createdAt?: string;
  content: string;
  thinkingObserved: boolean;
  toolCalls: OllamaToolCall[];
  doneReason?: string;
  totalDurationNs?: number;
  loadDurationNs?: number;
  promptTokens?: number;
  outputTokens?: number;
  promptEvalDurationNs?: number;
  evalDurationNs?: number;
}

export class OllamaGateway implements AgentAdapter<OllamaGatewayConfig> {
  public readonly name = "ollama";
  public readonly version = "api-v1";
  public readonly capabilities = OLLAMA_CAPABILITIES;
  private readonly handlers = new Set<AgentEventHandler>();
  private config?: OllamaGatewayConfig;
  private endpoint?: URL;
  private running = false;

  public async initialize(config: OllamaGatewayConfig): Promise<void> {
    const endpoint = new URL(config.baseUrl);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new TypeError("Ollama base URL must use HTTP or HTTPS");
    if (endpoint.username !== "" || endpoint.password !== "") throw new TypeError("Credentials must not be embedded in the Ollama base URL");
    this.config = config;
    this.endpoint = endpoint;
  }
  public async start(): Promise<void> {
    if (this.config === undefined) throw new Error("Ollama gateway must be initialized before start");
    this.running = true;
  }
  public async stop(): Promise<void> { this.running = false; }
  public onEvent(handler: AgentEventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  public chat(request: OllamaChatRequest, invocation: OllamaInvocation): Promise<OllamaGatewayResponse> {
    const prompt = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "not_available";
    return this.invoke("chat", request, invocation, prompt, {
      messageCount: request.messages.length,
      toolNames: toolNames(request.tools),
      thinkRequested: request.think ?? false
    });
  }

  public generate(request: OllamaGenerateRequest, invocation: OllamaInvocation): Promise<OllamaGatewayResponse> {
    return this.invoke("generate", request, invocation, request.prompt ?? "not_available", {
      hasSystemPrompt: request.system !== undefined,
      hasSuffix: request.suffix !== undefined,
      thinkRequested: request.think ?? false,
      raw: request.raw ?? false
    });
  }

  private async invoke(
    operation: "chat" | "generate",
    request: OllamaChatRequest | OllamaGenerateRequest,
    invocation: OllamaInvocation,
    prompt: string,
    requestSummary: Readonly<Record<string, unknown>>
  ): Promise<OllamaGatewayResponse> {
    this.assertRunning();
    if (request.model.trim() === "") throw new TypeError("Ollama model is required");
    const invocationId = invocation.idempotencyKey ?? this.config!.ids.generate();
    await this.publish(invocation.context, {
      eventType: "PROMPT_SUBMITTED", providerEventId: `${invocationId}:prompt`, evidence: "OBSERVED",
      actor: { type: "human", name: "ollama-api-caller" }, provider: "ollama",
      payload: { promptId: invocationId, content: prompt, reasoningAvailability: "NOT_AVAILABLE", endpoint: operation }
    });
    await this.publish(invocation.context, {
      eventType: "MODEL_REQUEST", providerEventId: `${invocationId}:request`, evidence: "OBSERVED",
      actor: { type: "model", id: request.model, name: request.model }, provider: "ollama",
      payload: {
        invocationId, provider: "ollama", model: request.model,
        modelVersion: modelTag(request.model), stream: request.stream !== false, ...requestSummary
      }
    });

    let upstream: Response;
    try {
      upstream = await (this.config!.fetch ?? globalThis.fetch)(
        new URL(`/api/${operation}`, this.endpoint),
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }
      );
    } catch (error) {
      await this.publishError(invocation.context, invocationId, operation, error);
      throw error;
    }
    const capture = upstream.clone();
    const provenance = this.captureResponse(capture, invocation.context, invocationId, request.model, operation);
    return { response: upstream, provenance };
  }

  private async captureResponse(
    response: Response,
    context: OllamaInvocation["context"],
    invocationId: string,
    requestedModel: string,
    operation: "chat" | "generate"
  ): Promise<void> {
    if (!response.ok) {
      const body = (await limitedText(response, this.maxCaptureBytes())).slice(0, 4_096);
      await this.publishError(context, invocationId, operation, { status: response.status, body });
      return;
    }
    try {
      const aggregate = await parseOllamaResponse(response, operation, this.maxCaptureBytes());
      await this.publish(context, {
        eventType: "MODEL_RESPONSE", providerEventId: `${invocationId}:response`, evidence: "OBSERVED",
        actor: { type: "model", id: aggregate.model ?? requestedModel, name: aggregate.model ?? requestedModel },
        provider: "ollama", ...(aggregate.createdAt === undefined ? {} : { occurredAt: aggregate.createdAt }),
        payload: {
          invocationId, provider: "ollama", model: aggregate.model ?? requestedModel,
          responseText: aggregate.content, toolCalls: aggregate.toolCalls,
          providerExposedThinking: aggregate.thinkingObserved,
          reasoningContent: aggregate.thinkingObserved ? "not_captured" : "not_available",
          hiddenReasoning: "not_available",
          ...(aggregate.doneReason === undefined ? {} : { doneReason: aggregate.doneReason }),
          ...(aggregate.promptTokens === undefined ? {} : { inputTokens: aggregate.promptTokens }),
          ...(aggregate.outputTokens === undefined ? {} : { outputTokens: aggregate.outputTokens }),
          ...(aggregate.totalDurationNs === undefined ? {} : { totalDurationNs: aggregate.totalDurationNs }),
          ...(aggregate.loadDurationNs === undefined ? {} : { loadDurationNs: aggregate.loadDurationNs }),
          ...(aggregate.promptEvalDurationNs === undefined ? {} : { promptEvalDurationNs: aggregate.promptEvalDurationNs }),
          ...(aggregate.evalDurationNs === undefined ? {} : { evalDurationNs: aggregate.evalDurationNs })
        }
      });
    } catch (error) {
      await this.publishError(context, invocationId, operation, error);
      throw error;
    }
  }

  private async publishError(context: OllamaInvocation["context"], invocationId: string, operation: string, error: unknown): Promise<void> {
    await this.publish(context, {
      eventType: "ERROR", providerEventId: `${invocationId}:error`, evidence: "OBSERVED",
      actor: { type: "system", id: "ollama-gateway", name: "Ollama gateway" }, provider: "ollama",
      payload: { operation, error: safeError(error) }
    });
  }
  private async publish(context: OllamaInvocation["context"], event: Omit<NormalizedAgentEvent, keyof OllamaInvocation["context"]>): Promise<void> {
    const normalized: NormalizedAgentEvent = { ...context, ...event };
    await Promise.all([...this.handlers].map((handler) => handler(normalized)));
  }
  private maxCaptureBytes(): number { return this.config?.maxCaptureBytes ?? 16 * 1024 * 1024; }
  private assertRunning(): void { if (!this.running) throw new Error("Ollama gateway is not running"); }
}

async function parseOllamaResponse(response: Response, operation: "chat" | "generate", maxBytes: number): Promise<ResponseAggregate> {
  const text = await limitedText(response, maxBytes);
  const chunks = text.split(/\r?\n/u).filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
  const aggregate: ResponseAggregate = { content: "", thinkingObserved: false, toolCalls: [] };
  for (const chunk of chunks) {
    if (typeof chunk.model === "string") aggregate.model = chunk.model;
    if (typeof chunk.created_at === "string") aggregate.createdAt = chunk.created_at;
    const message = object(chunk.message);
    const content = operation === "chat" ? message.content : chunk.response;
    if (typeof content === "string") aggregate.content += content;
    if (typeof message.thinking === "string" && message.thinking !== "") aggregate.thinkingObserved = true;
    if (typeof chunk.thinking === "string" && chunk.thinking !== "") aggregate.thinkingObserved = true;
    if (Array.isArray(message.tool_calls)) aggregate.toolCalls.push(...message.tool_calls.map(toolCall).filter((value): value is OllamaToolCall => value !== null));
    assignNumber(aggregate, "totalDurationNs", chunk.total_duration);
    assignNumber(aggregate, "loadDurationNs", chunk.load_duration);
    assignNumber(aggregate, "promptTokens", chunk.prompt_eval_count);
    assignNumber(aggregate, "outputTokens", chunk.eval_count);
    assignNumber(aggregate, "promptEvalDurationNs", chunk.prompt_eval_duration);
    assignNumber(aggregate, "evalDurationNs", chunk.eval_duration);
    if (typeof chunk.done_reason === "string") aggregate.doneReason = chunk.done_reason;
  }
  return aggregate;
}

async function limitedText(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("maxCaptureBytes must be positive");
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw new Error("Ollama provenance capture limit exceeded");
    }
    result += decoder.decode(next.value, { stream: true });
  }
  return result + decoder.decode();
}

function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function toolCall(value: unknown): OllamaToolCall | null {
  const fn = object(object(value).function);
  return typeof fn.name === "string" ? { function: { name: fn.name, arguments: object(fn.arguments) } } : null;
}
function assignNumber(target: ResponseAggregate, key: keyof ResponseAggregate, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) (target as unknown as Record<string, unknown>)[key] = value;
}
function modelTag(model: string): string { return model.includes(":") ? model.slice(model.lastIndexOf(":") + 1) : "latest_alias"; }
function toolNames(tools: readonly unknown[] | undefined): string[] {
  return (tools ?? []).map((tool) => object(object(tool).function).name).filter((name): name is string => typeof name === "string");
}
function safeError(error: unknown): unknown {
  if (error instanceof Error) return { name: error.name, message: error.message };
  try { return JSON.parse(JSON.stringify(error)) as unknown; } catch { return String(error); }
}
