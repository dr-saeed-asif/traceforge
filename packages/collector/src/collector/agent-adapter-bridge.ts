import type { AgentEventHandler, NormalizedAgentEvent } from "@traceforge/adapter-contracts";
import { ProvenanceCollector } from "./provenance-collector.js";

export function createAgentAdapterBridge(
  collector: ProvenanceCollector,
  adapter: { readonly name: string; readonly version: string }
): AgentEventHandler {
  return async (event: NormalizedAgentEvent) => {
    await collector.collect({
      taskId: event.taskId,
      sessionId: event.sessionId,
      runId: event.runId,
      eventType: event.eventType,
      actor: event.actor,
      payload: event.payload,
      ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }),
      source: {
        adapter: adapter.name,
        adapterVersion: adapter.version,
        evidence: event.evidence,
        ...(event.provider === undefined ? {} : { provider: event.provider }),
        providerEventId: event.providerEventId
      }
    });
  };
}
