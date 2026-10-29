import { createHash } from "node:crypto";
import type { TraceEventOutcome, TraceEventType } from "../../domain/trace-event-types.js";

export interface TraceEventHashInput {
  readonly previousEventHash: string | null;
  readonly promptId: string;
  readonly sourceEventId: string;
  readonly sequenceNumber: number;
  readonly eventType: TraceEventType;
  readonly outcome: TraceEventOutcome;
  readonly occurredAt: string;
  readonly target: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Produces a stable SHA-256 hash independent of JavaScript object key order.
 * The previous hash is inside the signed content, forming a per-prompt chain.
 */
export function createTraceEventHash(input: TraceEventHashInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

/** Serializes JSON-compatible values with lexicographically sorted object keys. */
export function canonicalJson(value: unknown): string {
  return serialize(value, new Set<object>());
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) {
    assertNotCircular(value, ancestors);
    const serialized = `[${value.map(item => isOmittedJsonValue(item) ? "null" : serialize(item, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return serialized;
  }
  if (typeof value === "object") {
    assertNotCircular(value, ancestors);
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter(key => !isOmittedJsonValue(record[key]))
      .sort()
      .map(key => `${JSON.stringify(key)}:${serialize(record[key], ancestors)}`);
    ancestors.delete(value);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Value of type ${typeof value} is not JSON-compatible`);
}

function assertNotCircular(value: object, ancestors: Set<object>): void {
  if (ancestors.has(value)) throw new TypeError("Circular values cannot be canonicalized");
  ancestors.add(value);
}

function isOmittedJsonValue(value: unknown): boolean {
  return typeof value === "undefined" || typeof value === "function" || typeof value === "symbol";
}
