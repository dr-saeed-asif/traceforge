import type { StoredArtifact } from "@traceforge/application";
import type { ProvenanceEvent } from "@traceforge/domain";

export interface TraceEventInput {
  readonly eventType: ProvenanceEvent["eventType"];
  readonly actor: ProvenanceEvent["actor"];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt?: string;
  readonly provider?: string;
  readonly providerEventId?: string;
  readonly evidence?: ProvenanceEvent["source"]["evidence"];
}

export interface TraceContext {
  readonly taskId: string;
  readonly sessionId: string;
  readonly runId: string;
}

export interface TraceTransport {
  emit(context: TraceContext, event: TraceEventInput): Promise<ProvenanceEvent | null>;
  storeArtifact(content: Uint8Array): Promise<StoredArtifact>;
}
