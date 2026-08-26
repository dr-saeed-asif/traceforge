import type { Clock, DurableBuffer, EventRepository, IdGenerator } from "@traceforge/application";
import { canonicalize, sha256, type CanonicalJsonValue } from "@traceforge/crypto";
import type { ProvenanceEvent, UnhashedProvenanceEvent } from "@traceforge/domain";
import { RedactionPolicy, sealEvent } from "@traceforge/provenance";
import type { BufferedIngressEvent, RawProvenanceEvent } from "../contracts/raw-event.js";
import { CollectorError } from "../errors/collector-error.js";
import { RunSerialQueue } from "../queue/run-serial-queue.js";
import { redactJson } from "../redaction/redact-json.js";
import { validateRawEvent } from "../validation/validate-raw-event.js";

export interface CollectionResult {
  readonly status: "APPENDED" | "DUPLICATE";
  readonly event?: ProvenanceEvent;
}

export interface CollectorOptions {
  readonly queueCapacity?: number;
  readonly schemaVersion?: string;
  readonly redactionPolicy?: RedactionPolicy;
}

export class ProvenanceCollector {
  private readonly queue: RunSerialQueue;
  private readonly schemaVersion: string;
  private readonly redactionPolicy: RedactionPolicy;
  private running = false;

  public constructor(
    private readonly repository: EventRepository,
    private readonly buffer: DurableBuffer<BufferedIngressEvent>,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    options: CollectorOptions = {}
  ) {
    this.queue = new RunSerialQueue(options.queueCapacity ?? 1_000);
    this.schemaVersion = options.schemaVersion ?? "1.0.0";
    this.redactionPolicy = options.redactionPolicy ?? new RedactionPolicy();
  }

  public async start(): Promise<readonly CollectionResult[]> {
    this.running = true;
    return this.replayBuffered();
  }

  public async stop(): Promise<void> {
    this.running = false;
    await this.queue.shutdown();
  }

  public async collect(raw: RawProvenanceEvent): Promise<CollectionResult> {
    if (!this.running) throw new CollectorError("NOT_RUNNING", "Collector is not running");
    validateRawEvent(raw);
    const sanitized = this.sanitize(raw);
    const record: BufferedIngressEvent = {
      raw: sanitized,
      idempotencyKey: this.idempotencyKey(sanitized),
      eventId: this.ids.generate(),
      recordedAt: this.clock.now().toISOString()
    };
    const recordId = this.ids.generate();
    await this.buffer.put({ recordId, value: record });
    return this.queue.enqueue(raw.runId, async () => {
      const result = await this.persist(record);
      await this.buffer.remove(recordId);
      return result;
    });
  }

  public async replayBuffered(): Promise<readonly CollectionResult[]> {
    const records = await this.buffer.list();
    const results: CollectionResult[] = [];
    for (const record of records) {
      results.push(await this.queue.enqueue(record.value.raw.runId, async () => {
        const result = await this.persist(record.value);
        await this.buffer.remove(record.recordId);
        return result;
      }));
    }
    return results;
  }

  private async persist(record: BufferedIngressEvent): Promise<CollectionResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const head = await this.repository.getRunHead(record.raw.runId);
      const unhashed: UnhashedProvenanceEvent = {
        eventId: record.eventId,
        taskId: record.raw.taskId,
        sessionId: record.raw.sessionId,
        runId: record.raw.runId,
        sequence: (head?.sequence ?? 0) + 1,
        eventType: record.raw.eventType,
        occurredAt: record.raw.occurredAt ?? record.recordedAt,
        recordedAt: record.recordedAt,
        actor: record.raw.actor,
        source: record.raw.source,
        payload: record.raw.payload,
        previousEventHash: head?.eventHash ?? null,
        hashAlgorithm: "sha256",
        schemaVersion: record.raw.schemaVersion ?? this.schemaVersion
      };
      const event = sealEvent(unhashed);
      const result = await this.repository.append(event, record.idempotencyKey);
      if (result === "APPENDED") return { status: "APPENDED", event };
      if (result === "DUPLICATE") return { status: "DUPLICATE" };
    }
    throw new CollectorError("SEQUENCE_CONFLICT", "Could not allocate a run sequence after three attempts");
  }

  private sanitize(raw: RawProvenanceEvent): RawProvenanceEvent {
    const payload = redactJson(raw.payload, this.redactionPolicy) as Readonly<Record<string, unknown>>;
    const normalizedPayload = raw.eventType === "PROMPT_SUBMITTED" && typeof payload.content === "string"
      ? { ...payload, promptHash: sha256(payload.content) }
      : payload;
    return { ...raw, payload: normalizedPayload };
  }

  private idempotencyKey(raw: RawProvenanceEvent): string {
    if (raw.idempotencyKey !== undefined) return `${raw.source.adapter}:explicit:${raw.idempotencyKey}`;
    if (raw.source.providerEventId !== undefined) return `${raw.source.adapter}:provider:${raw.source.providerEventId}`;
    return `${raw.source.adapter}:content:${sha256(canonicalize(raw as unknown as CanonicalJsonValue))}`;
  }
}
