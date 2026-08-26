import { PROVENANCE_EVENT_TYPES } from "@traceforge/domain";
import type { RawProvenanceEvent } from "../contracts/raw-event.js";
import { CollectorError } from "../errors/collector-error.js";

const EVENT_TYPES = new Set<string>(PROVENANCE_EVENT_TYPES);

function required(value: string, field: string): void {
  if (value.trim().length === 0 || value.length > 512) {
    throw new CollectorError("INVALID_INPUT", `${field} must contain 1 to 512 characters`);
  }
}

export function validateRawEvent(value: RawProvenanceEvent): void {
  required(value.taskId, "taskId");
  required(value.sessionId, "sessionId");
  required(value.runId, "runId");
  required(value.source.adapter, "source.adapter");
  required(value.source.adapterVersion, "source.adapterVersion");
  if (!EVENT_TYPES.has(value.eventType)) {
    throw new CollectorError("INVALID_INPUT", `Unsupported event type: ${String(value.eventType)}`);
  }
  if (value.occurredAt !== undefined && !Number.isFinite(Date.parse(value.occurredAt))) {
    throw new CollectorError("INVALID_INPUT", "occurredAt must be an ISO-compatible timestamp");
  }
  if (value.actor.id === undefined && value.actor.name === undefined) {
    throw new CollectorError("INVALID_INPUT", "actor must include an id or name");
  }
  if (Object.getPrototypeOf(value.payload) !== Object.prototype && Object.getPrototypeOf(value.payload) !== null) {
    throw new CollectorError("INVALID_INPUT", "payload must be a plain object");
  }
}
