import type { ArtifactStore } from "@traceforge/application";
import { ProvenanceCollector } from "@traceforge/collector";
import type { TraceContext, TraceEventInput, TraceTransport } from "../contracts/trace-transport.js";

export class CollectorTraceTransport implements TraceTransport {
  public constructor(
    private readonly collector: ProvenanceCollector,
    private readonly artifacts: ArtifactStore,
    private readonly adapterVersion = "0.1.0"
  ) {}

  public async emit(context: TraceContext, input: TraceEventInput) {
    const result = await this.collector.collect({
      ...context,
      eventType: input.eventType,
      actor: input.actor,
      payload: input.payload,
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
      source: {
        adapter: "traceforge-sdk",
        adapterVersion: this.adapterVersion,
        evidence: input.evidence ?? "DECLARED",
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.providerEventId === undefined ? {} : { providerEventId: input.providerEventId })
      }
    });
    return result.event ?? null;
  }

  public storeArtifact(content: Uint8Array) {
    return this.artifacts.put(content);
  }
}
