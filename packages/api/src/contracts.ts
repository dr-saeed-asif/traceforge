import type { Approval, Artifact, GitCommit, ProvenanceEvent, RunGitAssociation, Task } from "@traceforge/domain";

export type ApiScope = "trace:read" | "trace:write" | "trace:ingest" | "trace:verify" | "artifact:read" | "approval:write";
export interface ApiPrincipal { readonly subject: string; readonly scopes: readonly ApiScope[]; }
export interface ApiAuthenticator { authenticate(request: Request): Promise<ApiPrincipal | null>; }
export interface ApiAuditRecord { readonly principal: string; readonly method: string; readonly path: string; readonly status: number; readonly occurredAt: string; }
export interface ApiAuditSink { record(record: ApiAuditRecord): Promise<void>; }

export interface RunDto { readonly runId: string; readonly taskId: string; readonly sessionId: string; readonly status: string; readonly startedAt?: string; readonly completedAt?: string; }
export interface ActivityDto { readonly activityId:string;readonly eventId:string;readonly runId:string;readonly sequence:number;readonly activityType:string;readonly actorName:string;readonly provider?:string;readonly model?:string;readonly summary:string;readonly occurredAt:string; }
export interface ResourceDto { readonly eventId: string; readonly sequence: number; readonly resourceType: unknown; readonly uri: unknown; readonly evidence: string; }
export interface CreateTaskDto { readonly title: string; readonly repository: string; readonly workspace: string; }
export interface CreateApprovalDto { readonly runId: string; readonly artifactId?: string; readonly manifestId?: string; readonly decision: "APPROVED" | "REJECTED" | "REQUESTED_CHANGES"; readonly comment?: string; }
export interface IntegrationContextDto { readonly adapter: string; readonly externalSessionId: string; readonly repository: string; readonly workspace: string; readonly developer: string; readonly agentName?: string; readonly agentVersion?: string; }
export interface IntegrationRunContext { readonly taskId: string; readonly sessionId: string; readonly runId: string; }
export interface IntegrationEventDto extends IntegrationRunContext { readonly eventType: string; readonly actor: Readonly<Record<string, unknown>>; readonly payload: Readonly<Record<string, unknown>>; readonly occurredAt?: string; readonly provider?: string; readonly providerEventId: string; readonly evidence: string; }
export interface TraceForgeIngestion { ensureContext(input: IntegrationContextDto): Promise<IntegrationRunContext>; ingest(input: IntegrationEventDto & { readonly adapter: string; readonly adapterVersion: string }): Promise<{ readonly status: string; readonly eventId?: string }>; }

export interface TraceForgeApiStore {
  createTask(input: CreateTaskDto & { readonly createdBy: string }): Promise<Task>;
  listTasks(): Promise<readonly Task[]>;
  getTask(taskId: string): Promise<Task | null>;
  getRun(runId: string): Promise<RunDto | null>;
  getLatestRun?(): Promise<RunDto | null>;
  listLatestActivities?(limit:number,runId?:string):Promise<readonly ActivityDto[]>;
  listRunEvents(runId: string): Promise<readonly ProvenanceEvent[]>;
  listRunArtifacts(runId: string): Promise<readonly Artifact[]>;
  getArtifact(artifactId: string): Promise<Artifact | null>;
  getArtifactContent(contentHash: string): Promise<Uint8Array | null>;
  createApproval(input: CreateApprovalDto & { readonly reviewer: string }): Promise<Approval>;
  getCommit(commitId: string): Promise<{ readonly commit: GitCommit; readonly associations: readonly RunGitAssociation[] } | null>;
}
