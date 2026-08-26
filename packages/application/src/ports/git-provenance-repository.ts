import type { GitCommit, RunGitAssociation } from "@traceforge/domain";

export interface CommitProvenance {
  readonly commit: GitCommit;
  readonly associations: readonly RunGitAssociation[];
}

export interface GitProvenanceRepository {
  saveCommit(commit: GitCommit): Promise<void>;
  associateRun(association: RunGitAssociation): Promise<void>;
  findCommitProvenance(repository: string, commitId: string): Promise<CommitProvenance | null>;
}
