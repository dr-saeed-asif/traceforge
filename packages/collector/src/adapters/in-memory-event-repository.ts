import type { AppendEventResult, EventRepository, RunHead } from "@traceforge/application";
import type { ProvenanceEvent } from "@traceforge/domain";

export class InMemoryEventRepository implements EventRepository {
  private readonly events = new Map<string, ProvenanceEvent[]>();
  private readonly idempotencyKeys = new Set<string>();

  public async getRunHead(runId: string): Promise<RunHead | null> {
    const event = this.events.get(runId)?.at(-1);
    return event === undefined ? null : { sequence: event.sequence, eventHash: event.eventHash };
  }

  public async append(event: ProvenanceEvent, idempotencyKey: string): Promise<AppendEventResult> {
    if (this.idempotencyKeys.has(idempotencyKey)) return "DUPLICATE";
    if (event.runId === undefined) return "CONFLICT";
    const runEvents = this.events.get(event.runId) ?? [];
    const head = runEvents.at(-1);
    const expectedSequence = (head?.sequence ?? 0) + 1;
    const expectedHash = head?.eventHash ?? null;
    if (event.sequence !== expectedSequence || event.previousEventHash !== expectedHash) return "CONFLICT";

    runEvents.push(Object.freeze(structuredClone(event)));
    this.events.set(event.runId, runEvents);
    this.idempotencyKeys.add(idempotencyKey);
    return "APPENDED";
  }

  public async listRunEvents(runId: string): Promise<readonly ProvenanceEvent[]> {
    return structuredClone(this.events.get(runId) ?? []);
  }
}
