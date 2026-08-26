import type { AdapterCapability } from "@traceforge/adapter-contracts";
import type { ProviderRequest, ProviderResponseSummary } from "./types.js";

export type ProviderName = "openai" | "anthropic" | "deepseek";
export interface ProviderProfile {
  readonly name: ProviderName;
  readonly defaultBaseUrl: string;
  readonly path: string;
  readonly version: string;
  readonly capabilities: readonly AdapterCapability[];
  requestPrompt(request: ProviderRequest): unknown;
  requestSummary(request: ProviderRequest): Readonly<Record<string, unknown>>;
  parse(text: string, streaming: boolean): ProviderResponseSummary;
}

const capabilities = (protocol: string): readonly AdapterCapability[] => [
  { capability: "prompt", support: "YES", evidence: `Observed in routed ${protocol} requests` },
  { capability: "response", support: "YES", evidence: `Observed in routed ${protocol} responses` },
  { capability: "tool_calls", support: "YES", evidence: "Captured only when the provider exposes structured calls" },
  { capability: "tool_execution", support: "NO", evidence: "The gateway forwards model traffic and does not execute tools" },
  { capability: "file_operations", support: "NO", evidence: "Not exposed by the model API" },
  { capability: "terminal_commands", support: "NO", evidence: "Not exposed by the model API" },
  { capability: "hidden_reasoning", support: "NO", evidence: "Raw reasoning/thinking is deliberately not captured" }
];

export const OPENAI_PROFILE: ProviderProfile = {
  name: "openai", defaultBaseUrl: "https://api.openai.com", path: "/v1/responses", version: "responses-v1",
  capabilities: capabilities("Responses API"),
  requestPrompt: (r) => r.input ?? "not_available",
  requestSummary: (r) => ({ toolNames: names(r.tools), instructionsPresent: r.instructions !== undefined }),
  parse: (text, streaming) => parseOpenAI(values(text, streaming))
};

export const ANTHROPIC_PROFILE: ProviderProfile = {
  name: "anthropic", defaultBaseUrl: "https://api.anthropic.com", path: "/v1/messages", version: "messages-v1",
  capabilities: capabilities("Messages API"),
  requestPrompt: (r) => r.messages ?? "not_available",
  requestSummary: (r) => ({ toolNames: names(r.tools), systemPromptPresent: r.system !== undefined, maxTokens: r.max_tokens }),
  parse: (text, streaming) => parseAnthropic(values(text, streaming))
};

export const DEEPSEEK_PROFILE: ProviderProfile = {
  name: "deepseek", defaultBaseUrl: "https://api.deepseek.com", path: "/chat/completions", version: "chat-completions-v1",
  capabilities: capabilities("Chat Completions API"),
  requestPrompt: (r) => r.messages ?? "not_available",
  requestSummary: (r) => ({ toolNames: names(r.tools), thinkingRequested: object(r.thinking).type === "enabled" }),
  parse: (text, streaming) => parseDeepSeek(values(text, streaming))
};

function values(text: string, streaming: boolean): Record<string, unknown>[] {
  if (!streaming) return [JSON.parse(text) as Record<string, unknown>];
  return text.split(/\r?\n\r?\n/u).flatMap((block) => {
    const data = block.split(/\r?\n/u).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim()).join("\n");
    if (data === "" || data === "[DONE]") return [];
    try { return [JSON.parse(data) as Record<string, unknown>]; } catch { return []; }
  });
}

function parseOpenAI(events: readonly Record<string, unknown>[]): ProviderResponseSummary {
  let text = "", final: Record<string, unknown> = {}, reasoning = false;
  const tools: Captured[] = [];
  for (const event of events) {
    if (String(event.type).startsWith("response.reasoning")) reasoning = true;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") text += event.delta;
    if (event.type === "response.function_call_arguments.done") tools.push({ id: string(event.call_id), name: String(event.name ?? "unknown"), arguments: jsonOrString(event.arguments) });
    const response = object(event.response);
    if (Object.keys(response).length > 0) final = response;
    if (event.object === "response") final = event;
  }
  if (text === "") text = openAIOutputText(final);
  for (const item of array(final.output).map(object)) {
    if (item.type === "reasoning") reasoning = true;
    if (item.type === "function_call") tools.push({ id: string(item.call_id), name: String(item.name ?? "unknown"), arguments: jsonOrString(item.arguments) });
  }
  const usage = object(final.usage);
  return result(final, text, tools, reasoning, usage.input_tokens, usage.output_tokens, final.status);
}

function parseAnthropic(events: readonly Record<string, unknown>[]): ProviderResponseSummary {
  let text = "", final: Record<string, unknown> = {}, reasoning = false;
  const tools: Captured[] = [], partial = new Map<number, string>();
  for (const event of events) {
    if (event.type === "message_start") final = object(event.message);
    const block = object(event.content_block), delta = object(event.delta);
    if (block.type === "thinking" || block.type === "redacted_thinking" || delta.type === "thinking_delta") reasoning = true;
    if (block.type === "text" && typeof block.text === "string") text += block.text;
    if (delta.type === "text_delta" && typeof delta.text === "string") text += delta.text;
    if (block.type === "tool_use") tools.push({ id: string(block.id), name: String(block.name ?? "unknown"), arguments: block.input ?? {} });
    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && typeof event.index === "number") partial.set(event.index, (partial.get(event.index) ?? "") + delta.partial_json);
    if (event.type === "message_delta") final = { ...final, ...object(event.message), usage: { ...object(final.usage), ...object(event.usage) } };
  }
  tools.forEach((tool, index) => { const value = partial.get(index + 1); if (value !== undefined) tool.arguments = jsonOrString(value); });
  if (events.length === 1) {
    final = events[0] ?? {};
    for (const block of array(final.content).map(object)) {
      if (block.type === "text" && typeof block.text === "string") text += block.text;
      if (block.type === "thinking" || block.type === "redacted_thinking") reasoning = true;
      if (block.type === "tool_use") tools.push({ id: string(block.id), name: String(block.name ?? "unknown"), arguments: block.input ?? {} });
    }
  }
  const usage = object(final.usage);
  return result(final, text, tools, reasoning, usage.input_tokens, usage.output_tokens, final.stop_reason);
}

function parseDeepSeek(events: readonly Record<string, unknown>[]): ProviderResponseSummary {
  let text = "", final: Record<string, unknown> = {}, reasoning = false;
  const calls = new Map<number, Captured>();
  for (const event of events) {
    final = { ...final, ...event, usage: event.usage ?? final.usage };
    const choice = object(array(event.choices)[0]), message = object(choice.message), delta = object(choice.delta);
    const content = typeof delta.content === "string" ? delta.content : message.content;
    if (typeof content === "string") text += content;
    if (typeof delta.reasoning_content === "string" || typeof message.reasoning_content === "string") reasoning = true;
    array(delta.tool_calls ?? message.tool_calls).map(object).forEach((call) => {
      const index = typeof call.index === "number" ? call.index : calls.size, fn = object(call.function);
      const current = calls.get(index) ?? { id: string(call.id), name: "", arguments: "" };
      if (typeof call.id === "string") current.id = call.id;
      if (typeof fn.name === "string") current.name += fn.name;
      if (typeof fn.arguments === "string") current.arguments = String(current.arguments) + fn.arguments;
      calls.set(index, current);
    });
    if (typeof choice.finish_reason === "string") final.finish_reason = choice.finish_reason;
  }
  const usage = object(final.usage);
  const tools = [...calls.values()].map((call) => ({ ...call, arguments: jsonOrString(call.arguments) }));
  return result(final, text, tools, reasoning, usage.prompt_tokens, usage.completion_tokens, final.finish_reason);
}

type Captured = { id: string | undefined; name: string; arguments: unknown };
function result(source: Record<string, unknown>, responseText: string, toolCalls: Captured[], reasoningObserved: boolean, input: unknown, output: unknown, finish: unknown): ProviderResponseSummary {
  return { responseText, toolCalls, reasoningObserved,
    ...(typeof source.model === "string" ? { model: source.model } : {}),
    ...(typeof source.id === "string" ? { responseId: source.id } : {}),
    ...(typeof input === "number" ? { inputTokens: input } : {}),
    ...(typeof output === "number" ? { outputTokens: output } : {}),
    ...(typeof finish === "string" ? { finishReason: finish } : {}) };
}
function openAIOutputText(response: Record<string, unknown>): string { return array(response.output).map(object).flatMap((i) => array(i.content).map(object)).filter((c) => c.type === "output_text").map((c) => typeof c.text === "string" ? c.text : "").join(""); }
function names(value: unknown): string[] { return array(value).map(object).map((v) => typeof v.name === "string" ? v.name : object(v.function).name).filter((v): v is string => typeof v === "string"); }
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function jsonOrString(value: unknown): unknown { if (typeof value !== "string") return value; try { return JSON.parse(value) as unknown; } catch { return value; } }
