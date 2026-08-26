import type { ProvenanceEvent } from "@traceforge/domain";

export interface RunHead {
  readonly sequence: number;
  readonly eventHash: string;
}

export type AppendEventResult = "APPENDED" | "DUPLICATE" | "CONFLICT";

export interface EventRepository {
  getRunHead(runId: string): Promise<RunHead | null>;
  append(event: ProvenanceEvent, idempotencyKey: string): Promise<AppendEventResult>;
  listRunEvents(runId: string): Promise<readonly ProvenanceEvent[]>;
}
