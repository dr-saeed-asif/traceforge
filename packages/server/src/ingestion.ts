import type { IntegrationContextDto, IntegrationEventDto, IntegrationRunContext, TraceForgeIngestion } from "@traceforge/api";
import type { CollectionResult, ProvenanceCollector, RawProvenanceEvent } from "@traceforge/collector";

export interface IntegrationContextRegistry {
  ensure(input: IntegrationContextDto): Promise<IntegrationRunContext>;
}
export interface RunStatusRepository {
  markCompleted(runId: string, completedAt: string): Promise<void>;
  markFailed(runId: string, completedAt: string): Promise<void>;
}
export interface EventCollector {
  collect(input: Parameters<ProvenanceCollector["collect"]>[0]): Promise<CollectionResult>;
}

export class CentralTraceForgeIngestion implements TraceForgeIngestion {
  public constructor(
    private readonly contexts: IntegrationContextRegistry,
    private readonly collector: EventCollector,
    private readonly statuses: RunStatusRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  public ensureContext(input: IntegrationContextDto): Promise<IntegrationRunContext> {
    return this.contexts.ensure(input);
  }

  public async ingest(input: IntegrationEventDto & { readonly adapter: string; readonly adapterVersion: string }): Promise<{ readonly status: string; readonly eventId?: string }> {
    const result = await this.collector.collect({
      taskId: input.taskId,
      sessionId: input.sessionId,
      runId: input.runId,
      eventType: input.eventType as RawProvenanceEvent["eventType"],
      actor: input.actor as unknown as RawProvenanceEvent["actor"],
      payload: input.payload,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      source: {
        adapter: input.adapter,
        adapterVersion: input.adapterVersion,
        evidence: input.evidence as RawProvenanceEvent["source"]["evidence"],
        providerEventId: input.providerEventId,
        ...(input.provider ? { provider: input.provider } : {})
      }
    });
    const completedAt = input.occurredAt ?? this.now().toISOString();
    if (input.eventType === "SESSION_COMPLETED") await this.statuses.markCompleted(input.runId, completedAt);
    if (input.eventType === "SESSION_ERROR") await this.statuses.markFailed(input.runId, completedAt);
    return { status: result.status, ...(result.event ? { eventId: result.event.eventId } : {}) };
  }
}
