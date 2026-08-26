import type { CommitProvenance, GitProvenanceRepository } from "@traceforge/application";
import type { GitAssociationEvidence, GitCommit, GitFileChange, RunGitAssociation } from "@traceforge/domain";
import type { Pool } from "pg";

interface CommitRow {
  repository: string; commit_id: string; branch: string | null; base_commit: string | null;
  author: string; author_email: string; committed_at: Date; changed_files: GitFileChange[];
}
interface AssociationRow {
  run_id: string; repository: string; commit_id: string; evidence: GitAssociationEvidence;
  matched_artifact_ids: string[]; unmatched_artifact_ids: string[];
}

export class PostgresGitProvenanceRepository implements GitProvenanceRepository {
  public constructor(private readonly pool: Pool) {}

  public async saveCommit(commit: GitCommit): Promise<void> {
    await this.pool.query(
      `INSERT INTO git_commits (repository,commit_id,branch,base_commit,author,author_email,committed_at,changed_files)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (repository,commit_id) DO NOTHING`,
      [commit.repository, commit.commitId, commit.branch, commit.baseCommit, commit.author,
        commit.authorEmail, commit.timestamp, JSON.stringify(commit.changedFiles)]
    );
  }

  public async associateRun(association: RunGitAssociation): Promise<void> {
    await this.pool.query(
      `INSERT INTO run_git_commits
         (run_id,repository,commit_id,evidence,matched_artifact_ids,unmatched_artifact_ids)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (run_id,repository,commit_id) DO UPDATE SET
         evidence = EXCLUDED.evidence,
         matched_artifact_ids = EXCLUDED.matched_artifact_ids,
         unmatched_artifact_ids = EXCLUDED.unmatched_artifact_ids,
         associated_at = now()`,
      [association.runId, association.repository, association.commitId, association.evidence,
        association.matchedArtifactIds, association.unmatchedArtifactIds]
    );
  }

  public async findCommitProvenance(repository: string, commitId: string): Promise<CommitProvenance | null> {
    const commitResult = await this.pool.query<CommitRow>(
      "SELECT * FROM git_commits WHERE repository = $1 AND commit_id = $2", [repository, commitId]
    );
    const row = commitResult.rows[0];
    if (row === undefined) return null;
    const associationResult = await this.pool.query<AssociationRow>(
      "SELECT * FROM run_git_commits WHERE repository = $1 AND commit_id = $2 ORDER BY associated_at, run_id",
      [repository, commitId]
    );
    return {
      commit: {
        repository: row.repository, commitId: row.commit_id, branch: row.branch,
        baseCommit: row.base_commit, author: row.author, authorEmail: row.author_email,
        timestamp: row.committed_at.toISOString(), changedFiles: row.changed_files
      },
      associations: associationResult.rows.map((item) => ({
        runId: item.run_id, repository: item.repository, commitId: item.commit_id,
        evidence: item.evidence, matchedArtifactIds: item.matched_artifact_ids,
        unmatchedArtifactIds: item.unmatched_artifact_ids
      }))
    };
  }
}
