/**
 * Canonical facts that may be stored in the verification event timeline.
 *
 * Provider-specific events must be normalized to these names at the adapter
 * boundary. The vocabulary uses past-tense facts because an event records
 * something observed, not an instruction to perform work.
 */
export const TRACE_EVENT_TYPES = [
  "PROMPT_SUBMITTED",
  "AGENT_STARTED",
  "MODEL_REQUESTED",
  "RESOURCE_ACCESSED",
  "FILE_READ",
  "FILE_CREATED",
  "FILE_MODIFIED",
  "FILE_DELETED",
  "DIRECTORY_CREATED",
  "COMMAND_STARTED",
  "COMMAND_COMPLETED",
  "BUILD_COMPLETED",
  "TEST_COMPLETED",
  "ARCHITECTURE_CHECK_COMPLETED",
  "FINAL_RESPONSE_CAPTURED",
  "AGENT_COMPLETED",
  "AGENT_FAILED",
  "SESSION_COMPLETED"
] as const;

export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

export const TRACE_EVENT_OUTCOMES = ["RECORDED", "SUCCEEDED", "FAILED"] as const;

export type TraceEventOutcome = (typeof TRACE_EVENT_OUTCOMES)[number];

const traceEventTypeValues = new Set<string>(TRACE_EVENT_TYPES);
const traceEventOutcomeValues = new Set<string>(TRACE_EVENT_OUTCOMES);

/** Validates an event type received from an adapter or persistence layer. */
export function isTraceEventType(value: unknown): value is TraceEventType {
  return typeof value === "string" && traceEventTypeValues.has(value);
}

/** Validates the normalized outcome attached to a trace event. */
export function isTraceEventOutcome(value: unknown): value is TraceEventOutcome {
  return typeof value === "string" && traceEventOutcomeValues.has(value);
}
