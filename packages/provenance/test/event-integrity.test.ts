import { describe, expect, it } from "vitest";
import type { ProvenanceEvent, UnhashedProvenanceEvent } from "@traceforge/domain";
import { sealEvent, verifyEventChain } from "../src/index.js";

function draft(sequence: number, previousEventHash: string | null): UnhashedProvenanceEvent {
  return {
    eventId: `event-${sequence}`,
    taskId: "task-1",
    sessionId: "session-1",
    runId: "run-1",
    sequence,
    eventType: sequence === 1 ? "AGENT_STARTED" : "FILE_MODIFIED",
    occurredAt: `2026-01-01T00:00:0${sequence}.000Z`,
    recordedAt: `2026-01-01T00:00:0${sequence}.100Z`,
    actor: { type: "agent", id: "agent-1", name: "test-agent" },
    source: {
      adapter: "contract-test",
      adapterVersion: "1.0.0",
      providerEventId: `provider-${sequence}`,
      evidence: "OBSERVED"
    },
    payload: { path: `src/file-${sequence}.ts` },
    previousEventHash,
    hashAlgorithm: "sha256",
    schemaVersion: "1.0.0"
  };
}

function createChain(length: number): ProvenanceEvent[] {
  const events: ProvenanceEvent[] = [];
  for (let sequence = 1; sequence <= length; sequence += 1) {
    events.push(sealEvent(draft(sequence, events.at(-1)?.eventHash ?? null)));
  }
  return events;
}

describe("event integrity", () => {
  it("verifies an A to B to C to D chain", () => {
    expect(verifyEventChain(createChain(4))).toEqual({ status: "VERIFIED", checkedEvents: 4 });
  });

  it("reports the modified historical event and diagnostics", () => {
    const events = createChain(4);
    const original = events[1];
    if (original === undefined) throw new Error("fixture missing");
    events[1] = { ...original, payload: { path: "src/tampered.ts" } };

    const result = verifyEventChain(events);
    expect(result.status).toBe("TAMPERED");
    expect(result.failedEventId).toBe("event-2");
    expect(result.failedSequence).toBe(2);
    expect(result.expectedHash).not.toBe(result.calculatedHash);
  });

  it("detects missing events", () => {
    const events = createChain(4);
    expect(verifyEventChain([events[0]!, events[2]!, events[3]!]).status).toBe("INCOMPLETE");
  });
});
