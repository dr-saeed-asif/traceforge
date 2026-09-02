import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { sealEvent } from "@traceforge/provenance";
import type { UnhashedProvenanceEvent } from "@traceforge/domain";
import { createMySqlPool, MySqlEventRepository, runMigrations } from "../src/index.js";

const connectionString = process.env.TEST_DATABASE_URL;
const databaseDescribe = connectionString === undefined || connectionString.trim() === "" ? describe.skip : describe;

databaseDescribe("MySQL adapters", () => {
  let pool: Pool;
  let repository: MySqlEventRepository;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const taskId = `task-${suffix}`;
  const sessionId = `session-${suffix}`;
  const runId = `run-${suffix}`;

  beforeAll(async () => {
    pool = createMySqlPool(connectionString!, 4);
    await runMigrations(pool, resolve(process.cwd(), "infrastructure/migrations"));
    await pool.query("INSERT INTO tasks (task_id,title,repository,workspace,created_at,created_by,status) VALUES (?,'Integration task','repo','workspace',UTC_TIMESTAMP(6),'test','IN_PROGRESS')", [taskId]);
    await pool.query("INSERT INTO sessions (session_id,task_id,started_at,developer) VALUES (?, ?, UTC_TIMESTAMP(6), 'test')", [sessionId, taskId]);
    await pool.query("INSERT INTO agent_runs (run_id,session_id,agent_id,agent_name,agent_version,status,started_at) VALUES (?, ?, 'agent','agent','1.0.0','RUNNING',UTC_TIMESTAMP(6))", [runId, sessionId]);
    repository = new MySqlEventRepository(pool);
  });

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query("DELETE FROM outbox_events WHERE aggregate_id = ?", [runId]);
      await pool.query("DELETE FROM ingress_receipts WHERE event_id IN (SELECT event_id FROM provenance_events WHERE run_id = ?)", [runId]);
      await pool.query("DELETE FROM opencode_activities WHERE run_id = ?", [runId]);
      await pool.query("DELETE FROM provenance_events WHERE run_id = ?", [runId]);
      await pool.query("DELETE FROM agent_runs WHERE run_id = ?", [runId]);
      await pool.query("DELETE FROM sessions WHERE session_id = ?", [sessionId]);
      await pool.query("DELETE FROM tasks WHERE task_id = ?", [taskId]);
      await pool.end();
    }
  });

  function event(sequence: number, previousEventHash: string | null) {
    const draft: UnhashedProvenanceEvent = {
      eventId: `event-${suffix}-${sequence}`, taskId, sessionId, runId, sequence,
      eventType: sequence === 1 ? "AGENT_STARTED" : "TOOL_COMPLETED",
      occurredAt: "2026-08-22T10:00:00.000Z", recordedAt: "2026-08-22T10:00:01.000Z",
      actor: { type: "agent", id: "agent" }, source: { adapter: "integration", adapterVersion: "1.0.0", evidence: "OBSERVED" },
      payload: { sequence }, previousEventHash, hashAlgorithm: "sha256", schemaVersion: "1.0.0"
    };
    return sealEvent(draft);
  }

  it("appends atomically and keeps provider retries idempotent", async () => {
    const first = event(1, null);
    expect(await repository.append(first, `idem-${suffix}-1`)).toBe("APPENDED");
    expect(await repository.append(first, `idem-${suffix}-1`)).toBe("DUPLICATE");
    const second = event(2, first.eventHash);
    expect(await repository.append(second, `idem-${suffix}-2`)).toBe("APPENDED");
    expect((await repository.listRunEvents(runId)).map((item) => item.sequence)).toEqual([1, 2]);
  });
  it("rejects a stale sequence and emits transactional outbox records", async () => {
    expect(await repository.append(event(1, null), `idem-${suffix}-stale`)).toBe("CONFLICT");
    const [messages] = await pool.query("SELECT message_id FROM outbox_events WHERE aggregate_id=? AND topic='provenance.event.appended'", [runId]);
    expect(messages).toHaveLength(2);
  });
});
