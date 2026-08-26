import type { Approval } from "@traceforge/domain";

export interface ApprovalRepository {
  add(approval: Approval): Promise<void>;
  listRunApprovals(runId: string): Promise<readonly Approval[]>;
}
