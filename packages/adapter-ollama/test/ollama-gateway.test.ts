import type { AdapterRunContext } from "@traceforge/adapter-contracts";
import type { Clock, IdGenerator } from "@traceforge/application";
import {
  createAgentAdapterBridge,
  InMemoryDurableBuffer,
  InMemoryEventRepository,
  ProvenanceCollector,
  type BufferedIngressEvent
} from "@traceforge/collector";
import { verifyEventChain } from "@traceforge/provenance";
import { describe, expect, it, vi } from "vitest";
import { OllamaGateway, OLLAMA_CAPABILITIES } from "../src/index.js";

class FixedClock implements Clock { public now() { return new Date("2026-08-22T12:00:00.000Z"); } }
class Ids implements IdGenerator { private value = 0; public generate() { this.value += 1; return `ollama-${this.value}`; } }
const context: AdapterRunContext = { taskId: "task-ollama", sessionId: "session-ollama", runId: "run-ollama" };

async function fixture(fetchImplementation: typeof fetch, maxCaptureBytes?: number) {
  const repository = new InMemoryEventRepository();
  const collector = new ProvenanceCollector(
    repository, new InMemoryDurableBuffer<BufferedIngressEvent>(), new FixedClock(), new Ids()
  );
  await collector.start();
  const gateway = new OllamaGateway();
  await gateway.initialize({
    baseUrl: "http://127.0.0.1:11434", fetch: fetchImplementation,
    clock: new FixedClock(), ids: new Ids(), ...(maxCaptureBytes === undefined ? {} : { maxCaptureBytes })
  });
  gateway.onEvent(createAgentAdapterBridge(collector, gateway));
  await gateway.start();
  return { repository, collector, gateway };
}

describe("OllamaGateway", () => {
  it("captures a non-streaming chat response while returning it unchanged", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "llama3.2:latest", stream: false });
      return Response.json({
        model: "llama3.2:latest", created_at: "2026-08-22T12:00:01.000Z",
        message: { role: "assistant", content: "Hello" }, done: true,
        total_duration: 1000, load_duration: 100, prompt_eval_count: 3,
        prompt_eval_duration: 200, eval_count: 2, eval_duration: 700
      });
    });
    const { gateway, repository, collector } = await fixture(fetchMock);
    const result = await gateway.chat({
      model: "llama3.2:latest", stream: false,
      messages: [{ role: "user", content: "password=do-not-store" }]
    }, { context, idempotencyKey: "chat-1" });
    await result.provenance;
    expect((await result.response.json() as { message: { content: string } }).message.content).toBe("Hello");
    const events = await repository.listRunEvents(context.runId);
    expect(events.map((event) => event.eventType)).toEqual(["PROMPT_SUBMITTED", "MODEL_REQUEST", "MODEL_RESPONSE"]);
    expect(JSON.stringify(events)).not.toContain("do-not-store");
    expect(events.at(-1)?.payload).toMatchObject({
      responseText: "Hello", inputTokens: 3, outputTokens: 2,
      totalDurationNs: 1000, providerExposedThinking: false
    });
    expect(verifyEventChain(events).status).toBe("VERIFIED");
    await gateway.stop(); await collector.stop();
  });

  it("captures NDJSON streaming content and requested tools without claiming execution", async () => {
    const ndjson = [
      { model: "qwen3:8b", created_at: "2026-08-22T12:00:01.000Z", message: { role: "assistant", content: "Use ", thinking: "private-looking trace" }, done: false },
      { model: "qwen3:8b", created_at: "2026-08-22T12:00:01.100Z", message: { role: "assistant", content: "weather", tool_calls: [{ function: { name: "get_weather", arguments: { city: "Tokyo" } } }] }, done: false },
      { model: "qwen3:8b", created_at: "2026-08-22T12:00:01.200Z", message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 9, eval_count: 4 }
    ].map((item) => JSON.stringify(item)).join("\n") + "\n";
    const { gateway, repository, collector } = await fixture(async () => new Response(ndjson, {
      headers: { "content-type": "application/x-ndjson" }
    }));
    const result = await gateway.chat({
      model: "qwen3:8b", messages: [{ role: "user", content: "Weather?" }],
      tools: [{ type: "function", function: { name: "get_weather" } }], stream: true, think: true
    }, { context, idempotencyKey: "stream-1" });
    expect(await result.response.text()).toBe(ndjson);
    await result.provenance;
    const events = await repository.listRunEvents(context.runId);
    expect(events.map((event) => event.eventType)).not.toContain("TOOL_STARTED");
    expect(events.at(-1)?.payload).toMatchObject({
      responseText: "Use weather", providerExposedThinking: true,
      reasoningContent: "not_captured",
      toolCalls: [{ function: { name: "get_weather", arguments: { city: "Tokyo" } } }]
    });
    expect(JSON.stringify(events)).not.toContain("private-looking trace");
    expect(OLLAMA_CAPABILITIES.find((item) => item.capability === "tool_execution")?.support).toBe("NO");
    await gateway.stop(); await collector.stop();
  });

  it("captures generate requests routed through the wrapper", async () => {
    const { gateway, repository, collector } = await fixture(async () => Response.json({
      model: "codegemma:latest", created_at: "2026-08-22T12:00:01.000Z",
      response: "generated", done: true, prompt_eval_count: 5, eval_count: 1
    }));
    const result = await gateway.generate({
      model: "codegemma", prompt: "Generate code", stream: false, raw: true
    }, { context, idempotencyKey: "generate-1" });
    await result.provenance;
    const events = await repository.listRunEvents(context.runId);
    expect(events[1]?.payload).toMatchObject({ modelVersion: "latest_alias", raw: true });
    expect(events[2]?.payload).toMatchObject({ responseText: "generated", model: "codegemma:latest" });
    await gateway.stop(); await collector.stop();
  });

  it("records HTTP failures without consuming the caller's response", async () => {
    const { gateway, repository, collector } = await fixture(async () => new Response(
      JSON.stringify({ error: "model not found" }), { status: 404 }
    ));
    const result = await gateway.generate({ model: "missing", prompt: "hello" }, { context, idempotencyKey: "error-1" });
    await result.provenance;
    expect(result.response.status).toBe(404);
    expect(await result.response.text()).toContain("model not found");
    expect((await repository.listRunEvents(context.runId)).at(-1)?.eventType).toBe("ERROR");
    await gateway.stop(); await collector.stop();
  });

  it("surfaces capture-limit failures and records an error", async () => {
    const { gateway, repository, collector } = await fixture(async () => new Response("x".repeat(100)), 20);
    const result = await gateway.generate({ model: "model", prompt: "hello" }, { context, idempotencyKey: "large-1" });
    await expect(result.provenance).rejects.toThrow("capture limit");
    expect(await result.response.text()).toBe("x".repeat(100));
    expect((await repository.listRunEvents(context.runId)).at(-1)?.eventType).toBe("ERROR");
    await gateway.stop(); await collector.stop();
  });
});
