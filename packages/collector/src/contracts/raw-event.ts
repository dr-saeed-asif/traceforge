import type { EventActor, EventSource, ProvenanceEventType } from "@traceforge/domain";

export interface RawProvenanceEvent {
  readonly taskId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly eventType: ProvenanceEventType;
  readonly occurredAt?: string;
  readonly actor: EventActor;
  readonly source: EventSource;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly schemaVersion?: string;
  readonly idempotencyKey?: string;
}

export interface BufferedIngressEvent {
  readonly raw: RawProvenanceEvent;
  readonly idempotencyKey: string;
  readonly eventId: string;
  readonly recordedAt: string;
}
