import type { ApprovalRepository } from "@traceforge/application";
import type { Approval, ApprovalDecision } from "@traceforge/domain";
import type { Pool } from "pg";

interface ApprovalRow {
  approval_id: string; run_id: string; artifact_id: string | null; manifest_id: string | null;
  reviewer: string; decision: ApprovalDecision; decided_at: Date; comment: string | null;
}

export class PostgresApprovalRepository implements ApprovalRepository {
  public constructor(private readonly pool: Pool) {}

  public async add(approval: Approval): Promise<void> {
    await this.pool.query(
      `INSERT INTO approvals (approval_id,run_id,artifact_id,manifest_id,reviewer,decision,decided_at,comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [approval.approvalId, approval.runId, approval.target.artifactId ?? null,
        approval.target.manifestId ?? null, approval.reviewer, approval.decision,
        approval.timestamp, approval.comment ?? null]
    );
  }

  public async listRunApprovals(runId: string): Promise<readonly Approval[]> {
    const result = await this.pool.query<ApprovalRow>(
      "SELECT * FROM approvals WHERE run_id = $1 ORDER BY decided_at, approval_id", [runId]
    );
    return result.rows.map((row) => ({
      approvalId: row.approval_id, runId: row.run_id,
      target: row.artifact_id === null ? { manifestId: row.manifest_id! } : { artifactId: row.artifact_id },
      reviewer: row.reviewer, decision: row.decision, timestamp: row.decided_at.toISOString(),
      ...(row.comment === null ? {} : { comment: row.comment })
    }));
  }
}
