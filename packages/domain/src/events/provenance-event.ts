import type {
  ActorType,
  EvidenceLevel,
  ProvenanceEventType
} from "./event-types.js";

export interface EventActor {
  readonly type: ActorType;
  readonly id?: string;
  readonly name?: string;
}

export interface EventSource {
  readonly adapter: string;
  readonly adapterVersion: string;
  readonly provider?: string;
  readonly providerEventId?: string;
  readonly evidence: EvidenceLevel;
}

export interface ProvenanceEvent<
  TType extends ProvenanceEventType = ProvenanceEventType,
  TPayload = Readonly<Record<string, unknown>>
> {
  readonly eventId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly runId?: string;
  readonly sequence: number;
  readonly eventType: TType;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actor: Readonly<EventActor>;
  readonly source: Readonly<EventSource>;
  readonly payload: Readonly<TPayload>;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
  readonly hashAlgorithm: "sha256";
  readonly schemaVersion: string;
}

export type UnhashedProvenanceEvent<
  TType extends ProvenanceEventType = ProvenanceEventType,
  TPayload = Readonly<Record<string, unknown>>
> = Omit<ProvenanceEvent<TType, TPayload>, "eventHash">;

export interface PromptSubmittedPayload {
  readonly promptId: string;
  readonly invocationId?: string;
  readonly content: string;
  readonly promptHash: string;
  readonly reasoningAvailability: "USER_VISIBLE_SUMMARY" | "NOT_AVAILABLE";
}

export interface FileEventPayload {
  readonly relativePath: string;
  readonly contentHash?: string;
  readonly size?: number;
}

export interface ArtifactCreatedPayload extends FileEventPayload {
  readonly artifactId: string;
  readonly mimeType: string;
}
