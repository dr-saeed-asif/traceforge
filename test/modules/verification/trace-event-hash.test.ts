import { describe, expect, it } from "vitest";
import { canonicalJson, createTraceEventHash } from "../../../src/modules/verification/index.js";

const baseEvent = {
  previousEventHash: null,
  promptId: "prompt-1",
  sourceEventId: "event-1",
  sequenceNumber: 1,
  eventType: "FILE_MODIFIED" as const,
  outcome: "SUCCEEDED" as const,
  occurredAt: "2026-09-19T12:00:00.000Z",
  target: "src/app.ts",
  metadata: { filePath: "src/app.ts", afterHash: "b", beforeHash: "a" }
};

describe("trace event integrity hashing", () => {
  it("canonicalizes objects independently of property insertion order", () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: 2 })).toBe(
      canonicalJson({ a: 2, nested: { a: 1, b: 2 }, z: 1 })
    );
  });

  it("produces the same hash for semantically identical metadata", () => {
    const reordered = {
      ...baseEvent,
      metadata: { beforeHash: "a", filePath: "src/app.ts", afterHash: "b" }
    };

    expect(createTraceEventHash(reordered)).toBe(createTraceEventHash(baseEvent));
  });

  it("changes the hash when evidence or the previous chain link changes", () => {
    const evidenceChanged = {
      ...baseEvent,
      metadata: { ...baseEvent.metadata, afterHash: "different" }
    };
    const chainChanged = { ...baseEvent, previousEventHash: "a".repeat(64) };

    expect(createTraceEventHash(evidenceChanged)).not.toBe(createTraceEventHash(baseEvent));
    expect(createTraceEventHash(chainChanged)).not.toBe(createTraceEventHash(baseEvent));
  });

  it("rejects circular metadata instead of hashing an ambiguous representation", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => canonicalJson(circular)).toThrow("Circular values cannot be canonicalized");
  });
});
