import type { AppendEventResult, EventRepository, RunHead } from "@traceforge/application";
import type { ProvenanceEvent } from "@traceforge/domain";
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { createHash } from "node:crypto";

interface HeadRow extends RowDataPacket { sequence: number | string; event_hash: string }
interface EventRow extends RowDataPacket {
  event_id: string; task_id: string; session_id: string; run_id: string; sequence: number | string;
  event_type: ProvenanceEvent["eventType"]; occurred_at: Date | string; recorded_at: Date | string;
  actor: ProvenanceEvent["actor"] | string; source: ProvenanceEvent["source"] | string;
  payload: ProvenanceEvent["payload"] | string; previous_event_hash: string | null;
  event_hash: string; hash_algorithm: "sha256"; schema_version: string;
}

export class MySqlEventRepository implements EventRepository {
  public constructor(private readonly pool: Pool) {}

  public async getRunHead(runId: string): Promise<RunHead | null> {
    const [rows] = await this.pool.query<HeadRow[]>(
      "SELECT sequence, event_hash FROM provenance_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1", [runId]
    );
    const row = rows[0];
    return row === undefined ? null : { sequence: Number(row.sequence), eventHash: row.event_hash };
  }

  public async append(event: ProvenanceEvent, idempotencyKey: string): Promise<AppendEventResult> {
    if (event.runId === undefined) return "CONFLICT";
    const connection = await this.pool.getConnection();
    const lockName = `traceforge_run_${createHash("sha256").update(event.runId).digest("hex")}`;
    try {
      await acquireLock(connection, lockName);
      await connection.beginTransaction();
      if (await this.isDuplicate(connection, idempotencyKey)) {
        await connection.commit();
        return "DUPLICATE";
      }
      const [headRows] = await connection.query<HeadRow[]>(
        "SELECT sequence, event_hash FROM provenance_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1 FOR UPDATE", [event.runId]
      );
      const head = headRows[0];
      const expectedSequence = (head === undefined ? 0 : Number(head.sequence)) + 1;
      const expectedHash = head?.event_hash ?? null;
      if (event.sequence !== expectedSequence || event.previousEventHash !== expectedHash) {
        await connection.rollback();
        return "CONFLICT";
      }
      await this.insertEvent(connection, event);
      await connection.query(
        "INSERT INTO ingress_receipts (idempotency_key, adapter, event_id) VALUES (?, ?, ?)",
        [idempotencyKey, event.source.adapter, event.eventId]
      );
      await connection.query(
        "INSERT INTO outbox_events (message_id, topic, aggregate_id, payload) VALUES (?, 'provenance.event.appended', ?, ?)",
        [`outbox-${event.eventId}`, event.runId, JSON.stringify(event)]
      );
      await connection.commit();
      return "APPENDED";
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if ((error as { code?: string }).code === "ER_DUP_ENTRY" && await this.isDuplicate(connection, idempotencyKey)) return "DUPLICATE";
      throw error;
    } finally {
      await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
      connection.release();
    }
  }

  public async listRunEvents(runId: string): Promise<readonly ProvenanceEvent[]> {
    const [rows] = await this.pool.query<EventRow[]>("SELECT * FROM provenance_events WHERE run_id = ? ORDER BY sequence", [runId]);
    return rows.map((row) => ({
      eventId: row.event_id, taskId: row.task_id, sessionId: row.session_id, runId: row.run_id,
      sequence: Number(row.sequence), eventType: row.event_type, occurredAt: iso(row.occurred_at),
      recordedAt: iso(row.recorded_at), actor: json(row.actor), source: json(row.source), payload: json(row.payload),
      previousEventHash: row.previous_event_hash, eventHash: row.event_hash, hashAlgorithm: row.hash_algorithm,
      schemaVersion: row.schema_version
    }));
  }

  private async isDuplicate(connection: PoolConnection, key: string): Promise<boolean> {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT 1 FROM ingress_receipts WHERE idempotency_key = ? LIMIT 1", [key]);
    return rows.length === 1;
  }

  private async insertEvent(connection: PoolConnection, event: ProvenanceEvent): Promise<void> {
    await connection.query<ResultSetHeader>(
      `INSERT INTO provenance_events (
        event_id, task_id, session_id, run_id, sequence, event_type,
        occurred_at, recorded_at, actor, source, payload, previous_event_hash,
        event_hash, hash_algorithm, schema_version
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [event.eventId, event.taskId, event.sessionId, event.runId, event.sequence, event.eventType,
        event.occurredAt, event.recordedAt, JSON.stringify(event.actor), JSON.stringify(event.source),
        JSON.stringify(event.payload), event.previousEventHash, event.eventHash, event.hashAlgorithm, event.schemaVersion]
    );
  }
}

async function acquireLock(connection: PoolConnection, lockName: string): Promise<void> {
  const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
  if (Number(rows[0]?.acquired) !== 1) throw new Error("Could not acquire the run append lock");
}
function iso(value: Date | string): string { return new Date(value).toISOString(); }
function json<T>(value: T | string): T { return typeof value === "string" ? JSON.parse(value) as T : value; }
