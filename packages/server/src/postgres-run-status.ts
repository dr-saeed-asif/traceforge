import type { Pool } from "pg";
import type { RunStatusRepository } from "./ingestion.js";

export class PostgresRunStatusRepository implements RunStatusRepository {
  public constructor(private readonly pool: Pick<Pool, "query">) {}
  public async markCompleted(runId: string, completedAt: string): Promise<void> {
    await this.pool.query("UPDATE agent_runs SET status='COMPLETED', completed_at=$2 WHERE run_id=$1", [runId, completedAt]);
  }
  public async markFailed(runId: string, completedAt: string): Promise<void> {
    await this.pool.query("UPDATE agent_runs SET status='FAILED', completed_at=$2 WHERE run_id=$1", [runId, completedAt]);
  }
}
