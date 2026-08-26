import type { Clock, EventRepository, IdGenerator } from "@traceforge/application";
import { describe, expect, it } from "vitest";
import {
  InMemoryDurableBuffer,
  InMemoryEventRepository,
  ProvenanceCollector,
  type BufferedIngressEvent,
  type RawProvenanceEvent
} from "../src/index.js";

class FixedClock implements Clock {
  public now(): Date { return new Date("2026-08-22T10:00:00.000Z"); }
}

class SequentialIds implements IdGenerator {
  private value = 0;
  public generate(): string { this.value += 1; return `id-${this.value}`; }
}

function raw(providerEventId: string, payload: Record<string, unknown> = { value: providerEventId }): RawProvenanceEvent {
  return {
    taskId: "task-1",
    sessionId: "session-1",
    runId: "run-1",
    eventType: "TOOL_COMPLETED",
    occurredAt: "2026-08-22T09:59:59.000Z",
    actor: { type: "tool", id: "tool-1" },
    source: {
      adapter: "test-adapter",
      adapterVersion: "1.0.0",
      providerEventId,
      evidence: "OBSERVED"
    },
    payload
  };
}

function makeCollector(repository = new InMemoryEventRepository(), buffer = new InMemoryDurableBuffer<BufferedIngressEvent>()) {
  return {
    repository,
    buffer,
    collector: new ProvenanceCollector(repository, buffer, new FixedClock(), new SequentialIds())
  };
}

describe("ProvenanceCollector", () => {
  it("serializes concurrent events within a run and creates a valid chain", async () => {
    const { collector, repository } = makeCollector();
    await collector.start();
    await Promise.all([collector.collect(raw("one")), collector.collect(raw("two")), collector.collect(raw("three"))]);

    const events = await repository.listRunEvents("run-1");
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events[1]?.previousEventHash).toBe(events[0]?.eventHash);
    expect(events[2]?.previousEventHash).toBe(events[1]?.eventHash);
    await collector.stop();
  });

  it("keeps duplicate provider events idempotent", async () => {
    const { collector, repository } = makeCollector();
    await collector.start();
    expect((await collector.collect(raw("same"))).status).toBe("APPENDED");
    expect((await collector.collect(raw("same"))).status).toBe("DUPLICATE");
    expect(await repository.listRunEvents("run-1")).toHaveLength(1);
    await collector.stop();
  });

  it("redacts nested secrets before hashing, buffering, and persistence", async () => {
    const { collector, repository, buffer } = makeCollector();
    await collector.start();
    await collector.collect(raw("secret", {
      command: "curl -H 'Authorization: Bearer raw-token-value' example.test",
      environment: { PASSWORD: "hunter2" },
      response: ["sk-abcdefghijklmnopqrstuv"]
    }));

    const serialized = JSON.stringify(await repository.listRunEvents("run-1"));
    expect(serialized).not.toContain("raw-token-value");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuv");
    expect(serialized).toContain("[REDACTED]");
    expect(await buffer.list()).toHaveLength(0);
    await collector.stop();
  });

  it("hashes the stored redacted prompt representation", async () => {
    const { collector, repository } = makeCollector();
    await collector.start();
    await collector.collect({
      ...raw("prompt", { content: "password=hunter2", reasoningAvailability: "NOT_AVAILABLE" }),
      eventType: "PROMPT_SUBMITTED"
    });
    const event = (await repository.listRunEvents("run-1"))[0];
    expect(event?.payload).toMatchObject({ content: "password=[REDACTED]" });
    expect(event?.payload.promptHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(event)).not.toContain("hunter2");
    await collector.stop();
  });

  it("retains a sanitized record after storage failure and replays it", async () => {
    const durable = new InMemoryDurableBuffer<BufferedIngressEvent>();
    const target = new InMemoryEventRepository();
    let unavailable = true;
    const failing: EventRepository = {
      getRunHead: (runId) => target.getRunHead(runId),
      listRunEvents: (runId) => target.listRunEvents(runId),
      append: async (event, key) => {
        if (unavailable) throw new Error("storage unavailable");
        return target.append(event, key);
      }
    };
    const first = makeCollector(failing, durable).collector;
    await first.start();
    await expect(first.collect(raw("recover", { password: "password=secret-value" }))).rejects.toThrow("storage unavailable");
    expect(await durable.list()).toHaveLength(1);
    expect(JSON.stringify(await durable.list())).not.toContain("secret-value");
    await first.stop();

    unavailable = false;
    const second = makeCollector(failing, durable).collector;
    expect(await second.start()).toHaveLength(1);
    expect(await target.listRunEvents("run-1")).toHaveLength(1);
    expect(await durable.list()).toHaveLength(0);
    await second.stop();
  });

  it("rejects malformed input before it enters the durable buffer", async () => {
    const { collector, buffer } = makeCollector();
    await collector.start();
    await expect(collector.collect({ ...raw("bad"), runId: "" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await buffer.list()).toHaveLength(0);
    await collector.stop();
  });
});
