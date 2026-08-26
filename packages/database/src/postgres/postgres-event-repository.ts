import type { AppendEventResult, EventRepository, RunHead } from "@traceforge/application";
import type { ProvenanceEvent } from "@traceforge/domain";
import type { Pool, PoolClient } from "pg";

interface HeadRow { sequence: number; event_hash: string }
interface EventRow {
  event_id: string;
  task_id: string;
  session_id: string;
  run_id: string;
  sequence: number;
  event_type: ProvenanceEvent["eventType"];
  occurred_at: Date;
  recorded_at: Date;
  actor: ProvenanceEvent["actor"];
  source: ProvenanceEvent["source"];
  payload: ProvenanceEvent["payload"];
  previous_event_hash: string | null;
  event_hash: string;
  hash_algorithm: "sha256";
  schema_version: string;
}

export class PostgresEventRepository implements EventRepository {
  public constructor(private readonly pool: Pool) {}

  public async getRunHead(runId: string): Promise<RunHead | null> {
    const result = await this.pool.query<HeadRow>(
      "SELECT sequence, event_hash FROM provenance_events WHERE run_id = $1 ORDER BY sequence DESC LIMIT 1",
      [runId]
    );
    const row = result.rows[0];
    return row === undefined ? null : { sequence: Number(row.sequence), eventHash: row.event_hash };
  }

  public async append(event: ProvenanceEvent, idempotencyKey: string): Promise<AppendEventResult> {
    if (event.runId === undefined) return "CONFLICT";
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [event.runId]);
      if (await this.isDuplicate(client, idempotencyKey)) {
        await client.query("COMMIT");
        return "DUPLICATE";
      }
      const headResult = await client.query<HeadRow>(
        "SELECT sequence, event_hash FROM provenance_events WHERE run_id = $1 ORDER BY sequence DESC LIMIT 1",
        [event.runId]
      );
      const head = headResult.rows[0];
      const expectedSequence = (head === undefined ? 0 : Number(head.sequence)) + 1;
      const expectedHash = head?.event_hash ?? null;
      if (event.sequence !== expectedSequence || event.previousEventHash !== expectedHash) {
        await client.query("ROLLBACK");
        return "CONFLICT";
      }
      await this.insertEvent(client, event);
      await client.query(
        "INSERT INTO ingress_receipts (idempotency_key, adapter, event_id) VALUES ($1, $2, $3)",
        [idempotencyKey, event.source.adapter, event.eventId]
      );
      await client.query(
        `INSERT INTO outbox_events (message_id, topic, aggregate_id, payload)
         VALUES ($1, 'provenance.event.appended', $2, $3::jsonb)`,
        [`outbox-${event.eventId}`, event.runId, JSON.stringify(event)]
      );
      await client.query("COMMIT");
      return "APPENDED";
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505" && await this.isDuplicate(client, idempotencyKey)) {
        return "DUPLICATE";
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async listRunEvents(runId: string): Promise<readonly ProvenanceEvent[]> {
    const result = await this.pool.query<EventRow>(
      "SELECT * FROM provenance_events WHERE run_id = $1 ORDER BY sequence",
      [runId]
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      taskId: row.task_id,
      sessionId: row.session_id,
      runId: row.run_id,
      sequence: Number(row.sequence),
      eventType: row.event_type,
      occurredAt: row.occurred_at.toISOString(),
      recordedAt: row.recorded_at.toISOString(),
      actor: row.actor,
      source: row.source,
      payload: row.payload,
      previousEventHash: row.previous_event_hash,
      eventHash: row.event_hash,
      hashAlgorithm: row.hash_algorithm,
      schemaVersion: row.schema_version
    }));
  }

  private async isDuplicate(client: PoolClient, key: string): Promise<boolean> {
    return (await client.query("SELECT 1 FROM ingress_receipts WHERE idempotency_key = $1", [key])).rowCount === 1;
  }

  private async insertEvent(client: PoolClient, event: ProvenanceEvent): Promise<void> {
    await client.query(
      `INSERT INTO provenance_events (
        event_id, task_id, session_id, run_id, sequence, event_type,
        occurred_at, recorded_at, actor, source, payload, previous_event_hash,
        event_hash, hash_algorithm, schema_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15)`,
      [event.eventId, event.taskId, event.sessionId, event.runId, event.sequence,
        event.eventType, event.occurredAt, event.recordedAt, JSON.stringify(event.actor),
        JSON.stringify(event.source), JSON.stringify(event.payload), event.previousEventHash,
        event.eventHash, event.hashAlgorithm, event.schemaVersion]
    );
  }
}
