import type { AdapterRunContext } from "@traceforge/adapter-contracts";
import type { Clock, IdGenerator } from "@traceforge/application";
import { createAgentAdapterBridge, InMemoryDurableBuffer, InMemoryEventRepository, ProvenanceCollector, type BufferedIngressEvent } from "@traceforge/collector";
import { describe, expect, it, vi } from "vitest";
import { AnthropicGateway, DeepSeekGateway, OpenAIGateway, type ProviderGatewayConfig } from "../src/index.js";

class FixedClock implements Clock { public now() { return new Date("2026-08-22T12:00:00.000Z"); } }
class Ids implements IdGenerator { private value = 0; public generate() { return `provider-${++this.value}`; } }
const context: AdapterRunContext = { taskId: "task-provider", sessionId: "session-provider", runId: "run-provider" };

async function fixture<T extends OpenAIGateway | AnthropicGateway | DeepSeekGateway>(gateway: T, fetcher: typeof fetch, extra: Partial<ProviderGatewayConfig> = {}) {
  const repository = new InMemoryEventRepository();
  const collector = new ProvenanceCollector(repository, new InMemoryDurableBuffer<BufferedIngressEvent>(), new FixedClock(), new Ids());
  await collector.start();
  await gateway.initialize({ clock: new FixedClock(), ids: new Ids(), fetch: fetcher, headers: () => ({ authorization: "Bearer must-never-persist" }), ...extra });
  gateway.onEvent(createAgentAdapterBridge(collector, gateway)); await gateway.start();
  return { gateway, repository, collector };
}

describe("hosted provider gateways", () => {
  it("captures OpenAI Responses SSE text and function calls without reasoning", async () => {
    const sse = [
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello " })}`,
      `event: response.reasoning_summary_text.delta\ndata: ${JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "private chain" })}`,
      `event: response.function_call_arguments.done\ndata: ${JSON.stringify({ type: "response.function_call_arguments.done", call_id: "call_1", name: "weather", arguments: "{\"city\":\"Lahore\"}" })}`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", model: "gpt-test", status: "completed", usage: { input_tokens: 4, output_tokens: 2 } } })}`
    ].join("\n\n") + "\n\n";
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses"); expect(new Headers(init?.headers).get("authorization")).toContain("must-never-persist");
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    });
    const { gateway, repository, collector } = await fixture(new OpenAIGateway(), fetcher);
    const result = await gateway.invoke({ model: "gpt-test", input: "password=prompt-secret", stream: true, tools: [{ type: "function", name: "weather" }] }, { context, idempotencyKey: "openai-1" });
    expect(await result.response.text()).toBe(sse); await result.provenance;
    const events = await repository.listRunEvents(context.runId), serialized = JSON.stringify(events);
    expect(events.at(-1)?.payload).toMatchObject({ responseText: "Hello ", responseId: "resp_1", inputTokens: 4, outputTokens: 2, providerExposedReasoning: true, reasoningContent: "not_captured", toolCalls: [{ name: "weather", arguments: { city: "Lahore" } }] });
    expect(serialized).not.toContain("private chain"); expect(serialized).not.toContain("must-never-persist"); expect(serialized).not.toContain("prompt-secret");
    await gateway.stop(); await collector.stop();
  });

  it("captures Anthropic Messages SSE blocks and never stores thinking deltas", async () => {
    const records = [
      ["message_start", { type: "message_start", message: { id: "msg_1", model: "claude-test", usage: { input_tokens: 5 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }],
      ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool_1", name: "search", input: {} } }],
      ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"q\":\"docs\"}" } }],
      ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "thinking_delta", thinking: "secret thought" } }],
      ["message_delta", { type: "message_delta", message: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } }]
    ];
    const sse = records.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}`).join("\n\n") + "\n\n";
    const { gateway, repository, collector } = await fixture(new AnthropicGateway(), async (url) => { expect(String(url)).toBe("https://api.anthropic.com/v1/messages"); return new Response(sse); });
    const result = await gateway.invoke({ model: "claude-test", max_tokens: 100, messages: [{ role: "user", content: "Hi" }], stream: true }, { context, idempotencyKey: "anthropic-1" });
    await result.provenance; const events = await repository.listRunEvents(context.runId);
    expect(events.at(-1)?.payload).toMatchObject({ responseText: "Hi", inputTokens: 5, outputTokens: 3, finishReason: "tool_use", providerExposedReasoning: true, toolCalls: [{ id: "tool_1", name: "search", arguments: { q: "docs" } }] });
    expect(JSON.stringify(events)).not.toContain("secret thought"); await gateway.stop(); await collector.stop();
  });

  it("captures DeepSeek chat-completion JSON while suppressing reasoning_content", async () => {
    const body = { id: "ds_1", model: "deepseek-test", choices: [{ finish_reason: "stop", message: { content: "Done", reasoning_content: "private", tool_calls: [{ id: "call_2", function: { name: "lookup", arguments: "{\"id\":7}" } }] } }], usage: { prompt_tokens: 8, completion_tokens: 4 } };
    const { gateway, repository, collector } = await fixture(new DeepSeekGateway(), async (url) => { expect(String(url)).toBe("https://api.deepseek.com/chat/completions"); return Response.json(body); });
    const result = await gateway.invoke({ model: "deepseek-test", messages: [{ role: "user", content: "Go" }], stream: false }, { context, idempotencyKey: "deepseek-1" });
    await result.provenance; const events = await repository.listRunEvents(context.runId);
    expect(events.at(-1)?.payload).toMatchObject({ responseText: "Done", responseId: "ds_1", inputTokens: 8, outputTokens: 4, providerExposedReasoning: true, toolCalls: [{ name: "lookup", arguments: { id: 7 } }] });
    expect(JSON.stringify(events)).not.toContain("private"); expect(events.map((e) => e.eventType)).not.toContain("TOOL_STARTED"); await gateway.stop(); await collector.stop();
  });

  it("returns provider errors unchanged and records bounded capture failures", async () => {
    const first = await fixture(new OpenAIGateway(), async () => new Response("bad request", { status: 400 }));
    const failed = await first.gateway.invoke({ model: "gpt-test", input: "x" }, { context, idempotencyKey: "http-error" }); await failed.provenance;
    expect(failed.response.status).toBe(400); expect(await failed.response.text()).toBe("bad request"); expect((await first.repository.listRunEvents(context.runId)).at(-1)?.eventType).toBe("ERROR"); await first.gateway.stop(); await first.collector.stop();
    const second = await fixture(new DeepSeekGateway(), async () => new Response("x".repeat(50)), { maxCaptureBytes: 10 });
    const large = await second.gateway.invoke({ model: "deepseek-test", messages: [] }, { context, idempotencyKey: "too-large" });
    await expect(large.provenance).rejects.toThrow("capture limit"); expect(await large.response.text()).toBe("x".repeat(50)); await second.gateway.stop(); await second.collector.stop();
  });
});
