import type { Outbox, OutboxMessage } from "@traceforge/application";
import type { Pool } from "pg";

interface OutboxRow {
  message_id: string;
  topic: string;
  aggregate_id: string;
  payload: Readonly<Record<string, unknown>>;
  created_at: Date;
  attempts: number;
}

export class PostgresOutbox implements Outbox {
  public constructor(private readonly pool: Pool) {}

  public async claimBatch(workerId: string, limit: number, leaseMs: number): Promise<readonly OutboxMessage[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError("limit must be 1 to 1000");
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) throw new RangeError("leaseMs must be at least 1000");
    const result = await this.pool.query<OutboxRow>(
      `WITH candidates AS (
         SELECT message_id FROM outbox_events
         WHERE published_at IS NULL AND (locked_until IS NULL OR locked_until < now())
         ORDER BY created_at, message_id
         FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE outbox_events AS item
       SET locked_by = $2, locked_until = now() + ($3 * interval '1 millisecond'), attempts = attempts + 1
       FROM candidates WHERE item.message_id = candidates.message_id
       RETURNING item.message_id, item.topic, item.aggregate_id, item.payload, item.created_at, item.attempts`,
      [limit, workerId, leaseMs]
    );
    return result.rows.map((row) => ({
      messageId: row.message_id, topic: row.topic, aggregateId: row.aggregate_id,
      payload: row.payload, createdAt: row.created_at.toISOString(), attempts: row.attempts
    }));
  }

  public async acknowledge(messageId: string, workerId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE outbox_events SET published_at = now(), locked_by = NULL, locked_until = NULL, last_error = NULL
       WHERE message_id = $1 AND locked_by = $2 AND published_at IS NULL`,
      [messageId, workerId]
    );
    if (result.rowCount !== 1) throw new Error("Outbox message is not leased by this worker");
  }

  public async release(messageId: string, workerId: string, error: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE outbox_events SET locked_by = NULL, locked_until = NULL, last_error = left($3, 2000)
       WHERE message_id = $1 AND locked_by = $2 AND published_at IS NULL`,
      [messageId, workerId, error]
    );
    if (result.rowCount !== 1) throw new Error("Outbox message is not leased by this worker");
  }
}
