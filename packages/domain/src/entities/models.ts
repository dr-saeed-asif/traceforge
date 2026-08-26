export type TaskStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface Project {
  readonly projectId: string;
  readonly name: string;
  readonly repository?: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface Agent {
  readonly agentId: string;
  readonly name: string;
  readonly adapterName: string;
  readonly version?: string;
}

export interface Task {
  readonly taskId: string;
  readonly projectId?: string;
  readonly title: string;
  readonly repository: string;
  readonly workspace: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly status: TaskStatus;
}

export interface Session {
  readonly sessionId: string;
  readonly taskId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly developer: string;
  readonly environment: Readonly<Record<string, string>>;
}

export interface AgentRun {
  readonly runId: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly agentVersion: string;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface ModelInvocation {
  readonly invocationId: string;
  readonly runId: string;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion?: string;
  readonly requestId?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface TestExecution {
  readonly testExecutionId: string;
  readonly runId: string;
  readonly command: string;
  readonly framework?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly passed?: number;
  readonly failed?: number;
  readonly skipped?: number;
  readonly exitCode?: number;
  readonly outputReference?: string;
}

export interface Artifact {
  readonly artifactId: string;
  readonly runId: string;
  readonly artifactType: string;
  readonly relativePath: string;
  readonly mimeType: string;
  readonly size: number;
  readonly contentHash: string;
  readonly hashAlgorithm: "sha256";
  readonly createdAt: string;
  readonly createdByAgent: string;
  readonly storageReference: string;
}

export interface ArtifactManifest {
  readonly manifestId: string;
  readonly runId: string;
  readonly artifactIds: readonly string[];
  readonly manifestHash: string;
  readonly hashAlgorithm: "sha256";
}

export type ApprovalDecision = "APPROVED" | "REJECTED" | "REQUESTED_CHANGES";

export type ApprovalTarget =
  | { readonly artifactId: string; readonly manifestId?: never }
  | { readonly artifactId?: never; readonly manifestId: string };

export interface Approval {
  readonly approvalId: string;
  readonly runId: string;
  readonly target: ApprovalTarget;
  readonly reviewer: string;
  readonly decision: ApprovalDecision;
  readonly timestamp: string;
  readonly comment?: string;
}

export type FileOperation = "CREATED" | "MODIFIED" | "DELETED" | "RENAMED";

export interface GitFileChange {
  readonly path: string;
  readonly previousPath?: string;
  readonly operation: FileOperation;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly diffHash: string;
}

export interface GitCommit {
  readonly repository: string;
  readonly branch: string | null;
  readonly baseCommit: string | null;
  readonly commitId: string;
  readonly author: string;
  readonly authorEmail: string;
  readonly timestamp: string;
  readonly changedFiles: readonly GitFileChange[];
}

export type GitAssociationEvidence = "CONFIRMED" | "CANDIDATE" | "UNRESOLVED";

export interface RunGitAssociation {
  readonly runId: string;
  readonly repository: string;
  readonly commitId: string;
  readonly evidence: GitAssociationEvidence;
  readonly matchedArtifactIds: readonly string[];
  readonly unmatchedArtifactIds: readonly string[];
}
