import { sha256 } from "@traceforge/crypto";
import type { Approval, Artifact, GitCommit, ProvenanceEvent, RunGitAssociation, Task, UnhashedProvenanceEvent } from "@traceforge/domain";
import { sealEvent } from "@traceforge/provenance";
import { describe, expect, it } from "vitest";
import { StaticBearerAuthenticator, TraceForgeApi, type ApiAuditRecord, type ApiAuditSink, type CreateApprovalDto, type CreateTaskDto, type RunDto, type TraceForgeApiStore } from "../src/index.js";

const token = "traceforge-test-token-long-enough";
const readonlyToken = "traceforge-read-token-long-enough";
const content = new TextEncoder().encode("artifact bytes");
const artifact: Artifact = { artifactId: "artifact-1", runId: "run-1", artifactType: "source", relativePath: "src/a.ts", mimeType: "text/typescript", size: content.byteLength, contentHash: sha256(content), hashAlgorithm: "sha256", createdAt: "2026-08-22T12:00:00.000Z", createdByAgent: "agent", storageReference: "must-not-leak" };
const task: Task = { taskId: "task-1", title: "Build", repository: "repo", workspace: "workspace", createdAt: "2026-08-22T12:00:00.000Z", createdBy: "user-1", status: "OPEN" };
const unhashed: UnhashedProvenanceEvent = { eventId: "event-1", taskId: "task-1", sessionId: "session-1", runId: "run-1", sequence: 1, eventType: "RESOURCE_ACCESSED", occurredAt: "2026-08-22T12:00:00.000Z", recordedAt: "2026-08-22T12:00:00.000Z", actor: { type: "agent" }, source: { adapter: "test", adapterVersion: "1", evidence: "OBSERVED" }, payload: { resourceType: "documentation", uri: "https://example.test" }, previousEventHash: null, hashAlgorithm: "sha256", schemaVersion: "1" };
const event = sealEvent(unhashed);

class Store implements TraceForgeApiStore {
  public artifactContent: Uint8Array | null = content;
  public async createTask(input: CreateTaskDto & { createdBy: string }): Promise<Task> { return { ...task, ...input }; }
  public async listTasks(): Promise<readonly Task[]> { return [task]; }
  public async getTask(id: string): Promise<Task | null> { return id === task.taskId ? task : null; }
  public async getRun(id: string): Promise<RunDto | null> { return id === "run-1" ? { runId: id, taskId: "task-1", sessionId: "session-1", status: "COMPLETED" } : null; }
  public async listRunEvents(id: string): Promise<readonly ProvenanceEvent[]> { return id === "run-1" ? [event] : []; }
  public async listRunArtifacts(id: string): Promise<readonly Artifact[]> { return id === "run-1" ? [artifact] : []; }
  public async getArtifact(id: string): Promise<Artifact | null> { return id === artifact.artifactId ? artifact : null; }
  public async getArtifactContent(): Promise<Uint8Array | null> { return this.artifactContent; }
  public async createApproval(input: CreateApprovalDto & { reviewer: string }): Promise<Approval> { return { approvalId: "approval-1", runId: input.runId, target: input.artifactId ? { artifactId: input.artifactId } : { manifestId: input.manifestId! }, reviewer: input.reviewer, decision: input.decision, timestamp: "2026-08-22T12:00:00.000Z", ...(input.comment ? { comment: input.comment } : {}) }; }
  public async getCommit(id: string): Promise<{ commit: GitCommit; associations: readonly RunGitAssociation[] } | null> { return id === "abc" ? { commit: { repository: "repo", branch: "main", baseCommit: null, commitId: "abc", author: "A", authorEmail: "a@example.test", timestamp: "2026-08-22T12:00:00.000Z", changedFiles: [] }, associations: [{ runId: "run-1", repository: "repo", commitId: "abc", evidence: "CONFIRMED", matchedArtifactIds: ["artifact-1"], unmatchedArtifactIds: [] }] } : null; }
}
class Audit implements ApiAuditSink { public records: ApiAuditRecord[] = []; public async record(record: ApiAuditRecord) { this.records.push(record); } }
function api(store = new Store(), audit = new Audit()) { return { store, audit, value: new TraceForgeApi({ store, audit, now: () => new Date("2026-08-22T12:00:00.000Z"), authenticator: new StaticBearerAuthenticator([{ token, subject: "user-1", scopes: ["trace:read", "trace:write", "trace:verify", "artifact:read", "approval:write"] }, { token: readonlyToken, subject: "reader", scopes: ["trace:read"] }]) }) }; }
function request(path: string, init: RequestInit = {}, credential = token): Request { return new Request(`https://trace.test${path}`, { ...init, headers: { authorization: `Bearer ${credential}`, ...init.headers } }); }

describe("TraceForgeApi", () => {
  it("requires authentication and explicit scopes", async () => {
    const { value, audit } = api();
    expect((await value.handle(new Request("https://trace.test/api/v1/tasks"))).status).toBe(401);
    const denied = await value.handle(request("/api/v1/tasks", { method: "POST", body: JSON.stringify({ title: "x", repository: "r", workspace: "w" }) }, readonlyToken));
    expect(denied.status).toBe(403); expect((await denied.json() as any).error.code).toBe("FORBIDDEN"); expect(audit.records).toHaveLength(2);
  });

  it("validates task DTOs and derives createdBy from the principal", async () => {
    const { value } = api();
    expect((await value.handle(request("/api/v1/tasks", { method: "POST", body: "{}" }))).status).toBe(400);
    const response = await value.handle(request("/api/v1/tasks", { method: "POST", body: JSON.stringify({ title: "New", repository: "repo", workspace: "ws", createdBy: "attacker" }) }));
    expect(response.status).toBe(201); expect((await response.json() as any).task).toMatchObject({ title: "New", createdBy: "user-1" });
  });

  it("serves allowlisted task, run, resource, artifact, and commit DTOs", async () => {
    const { value } = api();
    for (const path of ["/api/v1/tasks", "/api/v1/tasks/task-1", "/api/v1/runs/run-1", "/api/v1/runs/run-1/events", "/api/v1/runs/run-1/agents", "/api/v1/runs/run-1/models", "/api/v1/runs/run-1/commands", "/api/v1/runs/run-1/tests", "/api/v1/runs/run-1/resources", "/api/v1/runs/run-1/artifacts", "/api/v1/artifacts/artifact-1", "/api/v1/commits/abc/provenance"]) expect((await value.handle(request(path))).status, path).toBe(200);
    const artifactResponse = await (await value.handle(request("/api/v1/artifacts/artifact-1"))).text(); expect(artifactResponse).not.toContain("must-not-leak");
  });

  it("verifies event chains and artifact bytes, exposing failures", async () => {
    const { value, store } = api();
    expect(await (await value.handle(request("/api/v1/runs/run-1/verify", { method: "POST" }))).json()).toMatchObject({ verification: { status: "VERIFIED", checkedEvents: 1 } });
    expect(await (await value.handle(request("/api/v1/artifacts/artifact-1/verify"))).json()).toMatchObject({ verification: { status: "VERIFIED" } });
    store.artifactContent = new TextEncoder().encode("tampered");
    expect(await (await value.handle(request("/api/v1/artifacts/artifact-1/verify"))).json()).toMatchObject({ verification: { status: "TAMPERED" } });
  });

  it("serves verified artifact bytes only to explicitly authorized principals",async()=>{const{value}=api();const denied=await value.handle(request("/api/v1/artifacts/artifact-1/content",{},readonlyToken));expect(denied.status).toBe(403);const response=await value.handle(request("/api/v1/artifacts/artifact-1/content"));expect(response.status).toBe(200);expect(response.headers.get("content-disposition")).toContain("a.ts");expect(new Uint8Array(await response.arrayBuffer())).toEqual(content)});

  it("binds approval reviewer identity to authentication and enforces one target", async () => {
    const { value } = api();
    const invalid = await value.handle(request("/api/v1/approvals", { method: "POST", body: JSON.stringify({ runId: "run-1", artifactId: "a", manifestId: "m", decision: "APPROVED" }) })); expect(invalid.status).toBe(400);
    const valid = await value.handle(request("/api/v1/approvals", { method: "POST", body: JSON.stringify({ runId: "run-1", artifactId: "artifact-1", decision: "APPROVED", reviewer: "attacker" }) }));
    expect(valid.status).toBe(201); expect((await valid.json() as any).approval.reviewer).toBe("user-1");
  });
});
