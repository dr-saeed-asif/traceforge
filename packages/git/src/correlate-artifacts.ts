import type { GitCommit, RunGitAssociation } from "@traceforge/domain";

export interface CorrelatableArtifact {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly contentHash: string;
}

export function correlateArtifacts(
  runId: string,
  artifacts: readonly CorrelatableArtifact[],
  commit: GitCommit
): RunGitAssociation {
  const matchedArtifactIds: string[] = [];
  const unmatchedArtifactIds: string[] = [];
  for (const artifact of artifacts) {
    const change = commit.changedFiles.find((candidate) => candidate.path === artifact.relativePath);
    if (change?.afterHash === artifact.contentHash) matchedArtifactIds.push(artifact.artifactId);
    else unmatchedArtifactIds.push(artifact.artifactId);
  }
  const evidence = artifacts.length > 0 && unmatchedArtifactIds.length === 0
    ? "CONFIRMED"
    : matchedArtifactIds.length > 0 ? "CANDIDATE" : "UNRESOLVED";
  return {
    runId, repository: commit.repository, commitId: commit.commitId, evidence,
    matchedArtifactIds, unmatchedArtifactIds
  };
}
