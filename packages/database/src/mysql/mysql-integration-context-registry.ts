import { randomUUID } from "node:crypto";
import type { IntegrationContextDto, IntegrationRunContext } from "@traceforge/api";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";

interface ContextRow extends RowDataPacket { taskId: string; sessionId: string; runId: string }
export class MySqlIntegrationContextRegistry {
  public constructor(private readonly pool: Pool) {}
  public async ensure(input: IntegrationContextDto): Promise<IntegrationRunContext> {
    const connection = await this.pool.getConnection();
    const lockName = `traceforge_context_${createHash("sha256").update(`${input.adapter}:${input.externalSessionId}`).digest("hex")}`;
    try {
      const [locks] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 30) AS acquired", [lockName]);
      if (Number(locks[0]?.acquired) !== 1) throw new Error("Could not acquire the integration context lock");
      await connection.beginTransaction();
      const [existing] = await connection.query<ContextRow[]>("SELECT task_id AS taskId, session_id AS sessionId, run_id AS runId FROM integration_run_contexts WHERE adapter=? AND external_session_id=?", [input.adapter, input.externalSessionId]);
      if (existing[0]) { await connection.commit(); return existing[0]; }
      const context = { taskId: randomUUID(), sessionId: randomUUID(), runId: randomUUID() };
      const now = new Date();
      await connection.query("INSERT INTO tasks(task_id,title,repository,workspace,created_at,created_by,status) VALUES(?,?,?,?,?,?,'IN_PROGRESS')", [context.taskId, `OpenCode session ${input.externalSessionId}`, input.repository, input.workspace, now, input.developer]);
      await connection.query("INSERT INTO sessions(session_id,task_id,started_at,developer,environment) VALUES(?,?,?,?,?)", [context.sessionId, context.taskId, now, input.developer, JSON.stringify({ adapter: input.adapter, externalSessionId: input.externalSessionId })]);
      await connection.query("INSERT INTO agent_runs(run_id,session_id,agent_id,agent_name,agent_version,status,started_at) VALUES(?,?,?,?,?,'RUNNING',?)", [context.runId, context.sessionId, input.adapter, input.agentName ?? input.adapter, input.agentVersion ?? "not_available", now]);
      await connection.query("INSERT INTO integration_run_contexts(adapter,external_session_id,task_id,session_id,run_id) VALUES(?,?,?,?,?)", [input.adapter, input.externalSessionId, context.taskId, context.sessionId, context.runId]);
      await connection.commit();
      return context;
    } catch (error) { await connection.rollback().catch(() => undefined); throw error; }
    finally { await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined); connection.release(); }
  }
}
