import type { AdapterRunContext, NormalizedAgentEvent } from "@traceforge/adapter-contracts";
import type { Clock, IdGenerator } from "@traceforge/application";
import {
  createAgentAdapterBridge,
  InMemoryDurableBuffer,
  InMemoryEventRepository,
  ProvenanceCollector,
  type BufferedIngressEvent
} from "@traceforge/collector";
import { verifyEventChain } from "@traceforge/provenance";
import { describe, expect, it } from "vitest";
import {
  createTraceForgeOpenCodePlugin,
  OpenCodeAdapter,
  OPENCODE_CAPABILITIES,
  type OpenCodeEvent
} from "../src/index.js";

class FixedClock implements Clock {
  private value = Date.parse("2026-08-22T12:00:00.000Z");
  public now() { const result = new Date(this.value); this.value += 1; return result; }
}
class Ids implements IdGenerator { private value = 0; public generate() { this.value += 1; return `oc-id-${this.value}`; } }

const context: AdapterRunContext = { taskId: "task-oc", sessionId: "session-trace", runId: "run-oc" };

async function fixture() {
  const repository = new InMemoryEventRepository();
  const collector = new ProvenanceCollector(
    repository, new InMemoryDurableBuffer<BufferedIngressEvent>(), new FixedClock(), new Ids()
  );
  await collector.start();
  const adapter = new OpenCodeAdapter();
  await adapter.initialize({
    contextForSession: async (sessionID) => sessionID === "oc-session" ? context : null,
    defaultContext: context,
    now: () => new Date("2026-08-22T12:00:00.000Z")
  });
  const normalized: NormalizedAgentEvent[] = [];
  adapter.onEvent(async (event) => { normalized.push(event); });
  adapter.onEvent(createAgentAdapterBridge(collector, adapter));
  await adapter.start();
  return { repository, collector, adapter, normalized };
}

describe("OpenCode adapter contract", () => {
  it("creates hooks matching the official OpenCode Plugin contract", async () => {
    const plugin = createTraceForgeOpenCodePlugin({
      adapterConfig: { contextForSession: async () => context },
      eventHandler: async () => undefined
    });
    const hooks = await plugin({} as never);
    expect(hooks.event).toBeTypeOf("function");
    expect(hooks["chat.message"]).toBeTypeOf("function");
    expect(hooks["tool.execute.before"]).toBeTypeOf("function");
    expect(hooks["tool.execute.after"]).toBeTypeOf("function");
    await hooks.dispose?.();
  });

  it("maps officially exposed prompt, agent, and model metadata", async () => {
    const { adapter, repository, collector, normalized } = await fixture();
    await adapter.handleChatMessage({
      sessionID: "oc-session", agent: "build", model: { providerID: "anthropic", modelID: "claude-test" }
    }, {
      message: {
        id: "user-message-1", sessionID: "oc-session", role: "user",
        time: { created: 1_777_000_000_000 }, agent: "build",
        model: { providerID: "anthropic", modelID: "claude-test" }
      },
      parts: [{
        id: "part-user-1", sessionID: "oc-session", messageID: "user-message-1",
        type: "text", text: "password=do-not-store"
      }]
    });
    await adapter.handleEvent({
      type: "message.updated",
      properties: { info: {
        id: "assistant-1", sessionID: "oc-session", role: "assistant", parentID: "user-message-1",
        time: { created: 1_777_000_000_100, completed: 1_777_000_000_500 },
        modelID: "claude-test", providerID: "anthropic", mode: "build", cost: 0.01,
        tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 2, write: 1 } }
      } }
    } as OpenCodeEvent);

    const events = await repository.listRunEvents(context.runId);
    expect(events.map((event) => event.eventType)).toEqual([
      "PROMPT_SUBMITTED", "AGENT_STARTED", "MODEL_REQUEST", "MODEL_RESPONSE"
    ]);
    expect(JSON.stringify(events)).not.toContain("do-not-store");
    expect(events[3]?.payload).toMatchObject({
      provider: "anthropic", model: "claude-test", inputTokens: 10,
      outputTokens: 20, responseContent: "not_available", hiddenReasoning: "not_available"
    });
    expect(normalized.every((event) => event.evidence === "OBSERVED")).toBe(true);
    expect(verifyEventChain(events).status).toBe("VERIFIED");
    await adapter.stop();
    await collector.stop();
  });

  it("captures tool and terminal activity without executing commands itself", async () => {
    const { adapter, repository, collector } = await fixture();
    await adapter.handleToolBefore({ tool: "bash", sessionID: "oc-session", callID: "call-1" }, {
      command: "npm test", workdir: "project"
    });
    await adapter.handleToolAfter({
      tool: "bash", sessionID: "oc-session", callID: "call-1",
      args: { command: "npm test", workdir: "project" }
    }, { title: "Tests", output: "passed", metadata: { exit: 0 } });
    await adapter.handleToolBefore({ tool: "webfetch", sessionID: "oc-session", callID: "call-2" }, {
      url: "https://opencode.ai/docs/plugins/"
    });
    await adapter.handleToolAfter({
      tool: "webfetch", sessionID: "oc-session", callID: "call-2",
      args: { url: "https://opencode.ai/docs/plugins/" }
    }, { title: "Plugins", output: "documentation", metadata: {} });

    const events = await repository.listRunEvents(context.runId);
    expect(events.map((event) => event.eventType)).toEqual([
      "TOOL_STARTED", "TERMINAL_COMMAND_STARTED", "TOOL_COMPLETED", "TERMINAL_COMMAND_COMPLETED",
      "TOOL_STARTED", "TOOL_COMPLETED", "RESOURCE_ACCESSED"
    ]);
    expect(events.at(-1)?.payload).toMatchObject({
      url: "https://opencode.ai/docs/plugins/", verification: "OBSERVED"
    });
    await adapter.stop();
    await collector.stop();
  });

  it("hashes session diffs without storing source bytes and remains idempotent", async () => {
    const { adapter, repository, collector } = await fixture();
    const event = {
      type: "session.diff",
      properties: {
        sessionID: "oc-session",
        diff: [{ file: "src/new.ts", before: "", after: "export const secret = 42;", additions: 1, deletions: 0 }]
      }
    } as OpenCodeEvent;
    await adapter.handleEvent(event);
    await adapter.handleEvent(event);
    const events = await repository.listRunEvents(context.runId);
    expect(events).toHaveLength(2);
    expect(events.map((item) => item.eventType)).toEqual(["FILE_CREATED", "CODE_DIFF_GENERATED"]);
    expect(JSON.stringify(events)).not.toContain("export const secret");
    expect(events[0]?.payload).toMatchObject({ operation: "CREATED", beforeHash: null });
    expect(events[0]?.payload.afterHash).toMatch(/^[a-f0-9]{64}$/u);
    await adapter.stop();
    await collector.stop();
  });

  it("labels only explicitly emitted reasoning parts as user-visible summaries", async () => {
    const { adapter, repository, collector } = await fixture();
    await adapter.handleEvent({
      type: "message.part.updated",
      properties: { part: {
        id: "reasoning-1", sessionID: "oc-session", messageID: "assistant-1",
        type: "reasoning", text: "Visible summary", time: { start: 1, end: 2 }
      } }
    } as OpenCodeEvent);
    const event = (await repository.listRunEvents(context.runId))[0];
    expect(event?.payload).toMatchObject({
      visibleReasoningSummary: "Visible summary", reasoningAvailability: "USER_VISIBLE_SUMMARY"
    });
    expect(OPENCODE_CAPABILITIES.find((item) => item.capability === "hidden_reasoning")?.support).toBe("NO");
    await adapter.stop();
    await collector.stop();
  });
});
