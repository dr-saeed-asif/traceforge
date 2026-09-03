import type { Pool, ResultSetHeader } from "mysql2/promise";
import type { RunStatusRepository } from "./ingestion.js";

export class MySqlRunStatusRepository implements RunStatusRepository {
  public constructor(private readonly pool: Pick<Pool, "query">) {}
  public async markCompleted(runId: string, completedAt: string): Promise<void> {
    await this.pool.query<ResultSetHeader>("UPDATE agent_runs SET status='COMPLETED', completed_at=? WHERE run_id=?", [completedAt, runId]);
  }
  public async markFailed(runId: string, completedAt: string): Promise<void> {
    await this.pool.query<ResultSetHeader>("UPDATE agent_runs SET status='FAILED', completed_at=? WHERE run_id=?", [completedAt, runId]);
  }
}
