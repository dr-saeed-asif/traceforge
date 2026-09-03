import type { CommitProvenance, GitProvenanceRepository } from "@traceforge/application";
import type { GitAssociationEvidence, GitCommit, GitFileChange, RunGitAssociation } from "@traceforge/domain";
import type { Pool, RowDataPacket } from "mysql2/promise";

interface CommitRow extends RowDataPacket { repository: string; commit_id: string; branch: string | null; base_commit: string | null; author: string; author_email: string; committed_at: Date | string; changed_files: GitFileChange[] | string }
interface AssociationRow extends RowDataPacket { run_id: string; repository: string; commit_id: string; evidence: GitAssociationEvidence; matched_artifact_ids: string[] | string; unmatched_artifact_ids: string[] | string }
export class MySqlGitProvenanceRepository implements GitProvenanceRepository {
  public constructor(private readonly pool: Pool) {}
  public async saveCommit(commit: GitCommit): Promise<void> {
    await this.pool.query(
      `INSERT INTO git_commits (repository,commit_id,branch,base_commit,author,author_email,committed_at,changed_files)
       VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE repository = repository`,
      [commit.repository, commit.commitId, commit.branch, commit.baseCommit, commit.author, commit.authorEmail, commit.timestamp, JSON.stringify(commit.changedFiles)]
    );
  }
  public async associateRun(association: RunGitAssociation): Promise<void> {
    await this.pool.query(
      `INSERT INTO run_git_commits (run_id,repository,commit_id,evidence,matched_artifact_ids,unmatched_artifact_ids)
       VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE evidence=VALUES(evidence), matched_artifact_ids=VALUES(matched_artifact_ids), unmatched_artifact_ids=VALUES(unmatched_artifact_ids), associated_at=UTC_TIMESTAMP(6)`,
      [association.runId, association.repository, association.commitId, association.evidence, JSON.stringify(association.matchedArtifactIds), JSON.stringify(association.unmatchedArtifactIds)]
    );
  }
  public async findCommitProvenance(repository: string, commitId: string): Promise<CommitProvenance | null> {
    const [commits] = await this.pool.query<CommitRow[]>("SELECT * FROM git_commits WHERE repository = ? AND commit_id = ?", [repository, commitId]);
    const row = commits[0];
    if (row === undefined) return null;
    const [associations] = await this.pool.query<AssociationRow[]>("SELECT * FROM run_git_commits WHERE repository = ? AND commit_id = ? ORDER BY associated_at, run_id", [repository, commitId]);
    return { commit: { repository: row.repository, commitId: row.commit_id, branch: row.branch, baseCommit: row.base_commit, author: row.author, authorEmail: row.author_email, timestamp: new Date(row.committed_at).toISOString(), changedFiles: parseJson(row.changed_files) }, associations: associations.map((item) => ({ runId: item.run_id, repository: item.repository, commitId: item.commit_id, evidence: item.evidence, matchedArtifactIds: parseJson(item.matched_artifact_ids), unmatchedArtifactIds: parseJson(item.unmatched_artifact_ids) })) };
  }
}
function parseJson<T>(value: T | string): T { return typeof value === "string" ? JSON.parse(value) as T : value; }
