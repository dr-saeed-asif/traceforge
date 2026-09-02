import type { Outbox, OutboxMessage } from "@traceforge/application";
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";

interface OutboxRow extends RowDataPacket { message_id: string; topic: string; aggregate_id: string; payload: Readonly<Record<string, unknown>> | string; created_at: Date | string; attempts: number | string }
export class MySqlOutbox implements Outbox {
  public constructor(private readonly pool: Pool) {}
  public async claimBatch(workerId: string, limit: number, leaseMs: number): Promise<readonly OutboxMessage[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError("limit must be 1 to 1000");
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) throw new RangeError("leaseMs must be at least 1000");
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      let rows: OutboxRow[];
      try {
        [rows] = await connection.query<OutboxRow[]>("SELECT message_id,topic,aggregate_id,payload,created_at,attempts FROM outbox_events WHERE published_at IS NULL AND (locked_until IS NULL OR locked_until < UTC_TIMESTAMP(6)) ORDER BY created_at, message_id LIMIT ? FOR UPDATE SKIP LOCKED", [limit]);
      } catch (error) {
        // MariaDB versions predating SKIP LOCKED retain transactional row locking but serialize claimers.
        if ((error as { code?: string }).code !== "ER_PARSE_ERROR") throw error;
        [rows] = await connection.query<OutboxRow[]>("SELECT message_id,topic,aggregate_id,payload,created_at,attempts FROM outbox_events WHERE published_at IS NULL AND (locked_until IS NULL OR locked_until < UTC_TIMESTAMP(6)) ORDER BY created_at, message_id LIMIT ? FOR UPDATE", [limit]);
      }
      for (const row of rows) await connection.query("UPDATE outbox_events SET locked_by=?, locked_until=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? MICROSECOND), attempts=attempts+1 WHERE message_id=?", [workerId, leaseMs * 1_000, row.message_id]);
      await connection.commit();
      return rows.map((row) => ({ messageId: row.message_id, topic: row.topic, aggregateId: row.aggregate_id, payload: typeof row.payload === "string" ? JSON.parse(row.payload) as Readonly<Record<string, unknown>> : row.payload, createdAt: new Date(row.created_at).toISOString(), attempts: Number(row.attempts) + 1 }));
    } catch (error) { await connection.rollback().catch(() => undefined); throw error; }
    finally { connection.release(); }
  }
  public async acknowledge(messageId: string, workerId: string): Promise<void> {
    const [result] = await this.pool.query<ResultSetHeader>("UPDATE outbox_events SET published_at=UTC_TIMESTAMP(6),locked_by=NULL,locked_until=NULL,last_error=NULL WHERE message_id=? AND locked_by=? AND published_at IS NULL", [messageId, workerId]);
    if (result.affectedRows !== 1) throw new Error("Outbox message is not leased by this worker");
  }
  public async release(messageId: string, workerId: string, error: string): Promise<void> {
    const [result] = await this.pool.query<ResultSetHeader>("UPDATE outbox_events SET locked_by=NULL,locked_until=NULL,last_error=LEFT(?,2000) WHERE message_id=? AND locked_by=? AND published_at IS NULL", [error, messageId, workerId]);
    if (result.affectedRows !== 1) throw new Error("Outbox message is not leased by this worker");
  }
}
