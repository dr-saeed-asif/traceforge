import type { AgentAdapter, AgentEventHandler, ModelGateway, ModelGatewayInvocation, ModelGatewayResult, NormalizedAgentEvent, Unsubscribe } from "@traceforge/adapter-contracts";
import type { ProviderGatewayConfig, ProviderRequest } from "./types.js";
import type { ProviderProfile } from "./profiles.js";

export class ProviderGateway implements AgentAdapter<ProviderGatewayConfig>, ModelGateway<ProviderRequest> {
  public readonly name: string;
  public readonly version: string;
  public readonly capabilities;
  private readonly handlers = new Set<AgentEventHandler>();
  private config?: ProviderGatewayConfig;
  private endpoint?: URL;
  private running = false;
  public constructor(private readonly profile: ProviderProfile) {
    this.name = profile.name; this.version = profile.version; this.capabilities = profile.capabilities;
  }
  public async initialize(config: ProviderGatewayConfig): Promise<void> {
    const endpoint = new URL(config.baseUrl ?? this.profile.defaultBaseUrl);
    if (!(["http:", "https:"] as const).includes(endpoint.protocol as "http:" | "https:")) throw new TypeError(`${this.name} base URL must use HTTP or HTTPS`);
    if (endpoint.username !== "" || endpoint.password !== "") throw new TypeError(`Credentials must not be embedded in the ${this.name} base URL`);
    const max = config.maxCaptureBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError("maxCaptureBytes must be positive");
    this.config = config; this.endpoint = endpoint;
  }
  public async start(): Promise<void> { if (!this.config) throw new Error(`${this.name} gateway must be initialized before start`); this.running = true; }
  public async stop(): Promise<void> { this.running = false; }
  public onEvent(handler: AgentEventHandler): Unsubscribe { this.handlers.add(handler); return () => { this.handlers.delete(handler); }; }
  public async invoke(request: ProviderRequest, invocation: ModelGatewayInvocation): Promise<ModelGatewayResult> {
    if (!this.running) throw new Error(`${this.name} gateway is not running`);
    if (typeof request.model !== "string" || request.model.trim() === "") throw new TypeError(`${this.name} model is required`);
    const id = invocation.idempotencyKey ?? this.config!.ids.generate();
    await this.publish(invocation.context, { eventType: "PROMPT_SUBMITTED", providerEventId: `${id}:prompt`, evidence: "OBSERVED", provider: this.name,
      actor: { type: "human", name: `${this.name}-api-caller` }, payload: { promptId: id, content: this.profile.requestPrompt(request), endpoint: this.profile.path, reasoningAvailability: "NOT_AVAILABLE" } });
    await this.publish(invocation.context, { eventType: "MODEL_REQUEST", providerEventId: `${id}:request`, evidence: "OBSERVED", provider: this.name,
      actor: { type: "model", id: request.model, name: request.model }, payload: { invocationId: id, provider: this.name, model: request.model, stream: request.stream === true, ...this.profile.requestSummary(request) } });
    let response: Response;
    try {
      const headers = new Headers(await this.config!.headers?.());
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      response = await (this.config!.fetch ?? globalThis.fetch)(new URL(this.profile.path, this.endpoint), { method: "POST", headers, body: JSON.stringify(request) });
    } catch (error) { await this.error(invocation, id, error); throw error; }
    return { response, provenance: this.capture(response.clone(), request, invocation, id) };
  }
  private async capture(response: Response, request: ProviderRequest, invocation: ModelGatewayInvocation, id: string): Promise<void> {
    try {
      const body = await limitedText(response, this.config!.maxCaptureBytes ?? 16 * 1024 * 1024);
      if (!response.ok) { await this.error(invocation, id, { status: response.status, body: body.slice(0, 4096) }); return; }
      const summary = this.profile.parse(body, request.stream === true);
      await this.publish(invocation.context, { eventType: "MODEL_RESPONSE", providerEventId: `${id}:response`, evidence: "OBSERVED", provider: this.name,
        actor: { type: "model", id: summary.model ?? request.model, name: summary.model ?? request.model }, payload: {
          invocationId: id, provider: this.name, model: summary.model ?? request.model, responseText: summary.responseText, toolCalls: summary.toolCalls,
          providerExposedReasoning: summary.reasoningObserved, reasoningContent: summary.reasoningObserved ? "not_captured" : "not_available", hiddenReasoning: "not_available",
          ...(summary.responseId === undefined ? {} : { responseId: summary.responseId }), ...(summary.inputTokens === undefined ? {} : { inputTokens: summary.inputTokens }),
          ...(summary.outputTokens === undefined ? {} : { outputTokens: summary.outputTokens }), ...(summary.finishReason === undefined ? {} : { finishReason: summary.finishReason })
        } });
    } catch (error) { await this.error(invocation, id, error); throw error; }
  }
  private async error(invocation: ModelGatewayInvocation, id: string, error: unknown): Promise<void> {
    await this.publish(invocation.context, { eventType: "ERROR", providerEventId: `${id}:error`, evidence: "OBSERVED", provider: this.name,
      actor: { type: "system", id: `${this.name}-gateway`, name: `${this.name} gateway` }, payload: { operation: this.profile.path, error: safeError(error) } });
  }
  private async publish(context: ModelGatewayInvocation["context"], event: Omit<NormalizedAgentEvent, keyof ModelGatewayInvocation["context"]>): Promise<void> {
    await Promise.all([...this.handlers].map((handler) => handler({ ...context, ...event })));
  }
}

async function limitedText(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) return "";
  const decoder = new TextDecoder(); let total = 0, result = "";
  while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength;
    if (total > max) { void reader.cancel().catch(() => undefined); throw new Error("Provider provenance capture limit exceeded"); }
    result += decoder.decode(next.value, { stream: true }); }
  return result + decoder.decode();
}
function safeError(error: unknown): unknown { if (error instanceof Error) return { name: error.name, message: error.message }; try { return JSON.parse(JSON.stringify(error)) as unknown; } catch { return String(error); } }
