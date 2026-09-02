import type { TraceForgeApiStore, CreateTaskDto, CreateApprovalDto, RunDto, ActivityDto } from "@traceforge/api";
import type { ArtifactStore, Clock, IdGenerator } from "@traceforge/application";
import type { Approval, Artifact, GitCommit, GitFileChange, RunGitAssociation, Task } from "@traceforge/domain";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { MySqlEventRepository } from "./mysql-event-repository.js";

interface TaskRow extends RowDataPacket { task_id: string; title: string; repository: string; workspace: string; created_at: Date | string; created_by: string; status: Task["status"] }
interface RunRow extends RowDataPacket { run_id: string; task_id: string; session_id: string; status: string; started_at: Date | string; completed_at: Date | string | null }
interface ArtifactRow extends RowDataPacket { artifact_id: string; run_id: string; artifact_type: string; relative_path: string; mime_type: string; size_bytes: number | string; content_hash: string; hash_algorithm: "sha256"; created_at: Date | string; created_by_agent: string; storage_reference: string }
interface CommitRow extends RowDataPacket { repository: string; commit_id: string; branch: string | null; base_commit: string | null; author: string; author_email: string; committed_at: Date | string; changed_files: GitFileChange[] | string }
interface AssociationRow extends RowDataPacket { run_id: string; repository: string; commit_id: string; evidence: RunGitAssociation["evidence"]; matched_artifact_ids: string[] | string; unmatched_artifact_ids: string[] | string }
interface ActivityRow extends RowDataPacket { activity_id: string; event_id: string; run_id: string; sequence: string | number; activity_type: string; actor_name: string; provider: string | null; model: string | null; summary: string; occurred_at: Date | string }

export class MySqlTraceForgeApiStore implements TraceForgeApiStore {
  private readonly events: MySqlEventRepository;
  public constructor(private readonly pool: Pool, private readonly artifacts: ArtifactStore, private readonly clock: Clock, private readonly ids: IdGenerator) { this.events = new MySqlEventRepository(pool); }
  public async createTask(input: CreateTaskDto & { readonly createdBy: string }): Promise<Task> {
    const task: Task = { taskId: this.ids.generate(), ...input, createdAt: this.clock.now().toISOString(), status: "OPEN" };
    await this.pool.query("INSERT INTO tasks (task_id,title,repository,workspace,created_at,created_by,status) VALUES (?,?,?,?,?,?,?)", [task.taskId, task.title, task.repository, task.workspace, task.createdAt, task.createdBy, task.status]);
    return task;
  }
  public async listTasks(): Promise<readonly Task[]> { const [rows] = await this.pool.query<TaskRow[]>("SELECT * FROM tasks ORDER BY created_at DESC, task_id DESC"); return rows.map(task); }
  public async getTask(id: string): Promise<Task | null> { const [rows] = await this.pool.query<TaskRow[]>("SELECT * FROM tasks WHERE task_id=?", [id]); return rows[0] ? task(rows[0]) : null; }
  public async getRun(id: string): Promise<RunDto | null> { const [rows] = await this.pool.query<RunRow[]>("SELECT r.run_id,s.task_id,r.session_id,r.status,r.started_at,r.completed_at FROM agent_runs r JOIN sessions s ON s.session_id=r.session_id WHERE r.run_id=?", [id]); return rows[0] ? run(rows[0]) : null; }
  public async getLatestRun(): Promise<RunDto | null> { const [rows] = await this.pool.query<RunRow[]>("SELECT r.run_id,s.task_id,r.session_id,r.status,r.started_at,r.completed_at FROM agent_runs r JOIN sessions s ON s.session_id=r.session_id JOIN integration_run_contexts c ON c.run_id=r.run_id ORDER BY c.created_at DESC LIMIT 1"); return rows[0] ? run(rows[0]) : null; }
  public async listLatestActivities(limit: number, runId?: string): Promise<readonly ActivityDto[]> {
    const [rows] = runId === undefined
      ? await this.pool.query<ActivityRow[]>("SELECT activity_id,event_id,run_id,sequence,activity_type,actor_name,provider,model,summary,occurred_at FROM opencode_activities ORDER BY recorded_at DESC,activity_id DESC LIMIT ?", [limit])
      : await this.pool.query<ActivityRow[]>("SELECT activity_id,event_id,run_id,sequence,activity_type,actor_name,provider,model,summary,occurred_at FROM opencode_activities WHERE run_id=? ORDER BY recorded_at DESC,activity_id DESC LIMIT ?", [runId, limit]);
    return rows.map((row) => ({ activityId: row.activity_id, eventId: row.event_id, runId: row.run_id, sequence: Number(row.sequence), activityType: row.activity_type, actorName: row.actor_name, ...(row.provider ? { provider: row.provider } : {}), ...(row.model ? { model: row.model } : {}), summary: row.summary, occurredAt: iso(row.occurred_at) }));
  }
  public listRunEvents(id: string) { return this.events.listRunEvents(id); }
  public async listRunArtifacts(id: string): Promise<readonly Artifact[]> { const [rows] = await this.pool.query<ArtifactRow[]>("SELECT * FROM artifacts WHERE run_id=? ORDER BY created_at,artifact_id", [id]); return rows.map(artifact); }
  public async getArtifact(id: string): Promise<Artifact | null> { const [rows] = await this.pool.query<ArtifactRow[]>("SELECT * FROM artifacts WHERE artifact_id=?", [id]); return rows[0] ? artifact(rows[0]) : null; }
  public getArtifactContent(hash: string) { return this.artifacts.get(hash); }
  public async createApproval(input: CreateApprovalDto & { readonly reviewer: string }): Promise<Approval> {
    const value: Approval = { approvalId: this.ids.generate(), runId: input.runId, target: input.artifactId ? { artifactId: input.artifactId } : { manifestId: input.manifestId! }, reviewer: input.reviewer, decision: input.decision, timestamp: this.clock.now().toISOString(), ...(input.comment ? { comment: input.comment } : {}) };
    await this.pool.query("INSERT INTO approvals (approval_id,run_id,artifact_id,manifest_id,reviewer,decision,decided_at,comment) VALUES (?,?,?,?,?,?,?,?)", [value.approvalId, value.runId, value.target.artifactId ?? null, value.target.manifestId ?? null, value.reviewer, value.decision, value.timestamp, value.comment ?? null]);
    return value;
  }
  public async getCommit(id: string): Promise<{ readonly commit: GitCommit; readonly associations: readonly RunGitAssociation[] } | null> {
    const [rows] = await this.pool.query<CommitRow[]>("SELECT * FROM git_commits WHERE commit_id=? ORDER BY repository LIMIT 2", [id]);
    if (rows.length > 1) throw new Error("Commit ID is ambiguous across repositories");
    const row = rows[0];
    if (!row) return null;
    const [associations] = await this.pool.query<AssociationRow[]>("SELECT * FROM run_git_commits WHERE repository=? AND commit_id=? ORDER BY associated_at,run_id", [row.repository, id]);
    return { commit: { repository: row.repository, commitId: row.commit_id, branch: row.branch, baseCommit: row.base_commit, author: row.author, authorEmail: row.author_email, timestamp: iso(row.committed_at), changedFiles: parseJson(row.changed_files) }, associations: associations.map((item) => ({ runId: item.run_id, repository: item.repository, commitId: item.commit_id, evidence: item.evidence, matchedArtifactIds: parseJson(item.matched_artifact_ids), unmatchedArtifactIds: parseJson(item.unmatched_artifact_ids) })) };
  }
}
function iso(value: Date | string): string { return new Date(value).toISOString(); }
function parseJson<T>(value: T | string): T { return typeof value === "string" ? JSON.parse(value) as T : value; }
function task(row: TaskRow): Task { return { taskId: row.task_id, title: row.title, repository: row.repository, workspace: row.workspace, createdAt: iso(row.created_at), createdBy: row.created_by, status: row.status }; }
function run(row: RunRow): RunDto { return { runId: row.run_id, taskId: row.task_id, sessionId: row.session_id, status: row.status, startedAt: iso(row.started_at), ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}) }; }
function artifact(row: ArtifactRow): Artifact { return { artifactId: row.artifact_id, runId: row.run_id, artifactType: row.artifact_type, relativePath: row.relative_path, mimeType: row.mime_type, size: Number(row.size_bytes), contentHash: row.content_hash, hashAlgorithm: row.hash_algorithm, createdAt: iso(row.created_at), createdByAgent: row.created_by_agent, storageReference: row.storage_reference }; }
