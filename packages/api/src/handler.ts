import { sha256 } from "@traceforge/crypto";
import { verifyEventChain } from "@traceforge/provenance";
import type { ApiAuditSink, ApiAuthenticator, ApiPrincipal, ApiScope, CreateApprovalDto, CreateTaskDto, IntegrationContextDto, IntegrationEventDto, ResourceDto, TraceForgeApiStore, TraceForgeIngestion } from "./contracts.js";

export interface TraceForgeApiOptions { readonly store: TraceForgeApiStore; readonly authenticator: ApiAuthenticator; readonly ingestion?: TraceForgeIngestion; readonly audit?: ApiAuditSink; readonly maxBodyBytes?: number; readonly now?: () => Date; }

export class TraceForgeApi {
  public constructor(private readonly options: TraceForgeApiOptions) {}
  public async handle(request: Request): Promise<Response> {
    const url = new URL(request.url), path = url.pathname, principal = await this.options.authenticator.authenticate(request);
    if (!principal) return this.finish(request, "anonymous", json(401, { error: { code: "UNAUTHORIZED", message: "Valid bearer authentication is required" } }, { "www-authenticate": "Bearer" }));
    let response: Response;
    try { response = await this.route(request, path, principal); }
    catch (error) { response = error instanceof ApiError ? json(error.status, { error: { code: error.code, message: error.message } }) : json(500, { error: { code: "INTERNAL_ERROR", message: "Internal server error" } }); }
    return this.finish(request, principal.subject, response);
  }
  private async route(request: Request, path: string, principal: ApiPrincipal): Promise<Response> {
    if (path === "/api/v1/integrations/context" && request.method === "POST") { scope(principal,"trace:ingest"); if(!this.options.ingestion) return unavailable(); const body=integrationContextDto(await bodyJson(request,this.maxBody())); return json(200,{context:await this.options.ingestion.ensureContext(body)}); }
    if (path === "/api/v1/integrations/events" && request.method === "POST") { scope(principal,"trace:ingest"); if(!this.options.ingestion) return unavailable(); const body=integrationEventDto(await bodyJson(request,this.maxBody())); return json(202,{result:await this.options.ingestion.ingest(body)}); }
    if (path === "/api/v1/tasks" && request.method === "POST") {
      scope(principal, "trace:write"); const body = taskDto(await bodyJson(request, this.maxBody()));
      return json(201, { task: taskResponse(await this.options.store.createTask({ ...body, createdBy: principal.subject })) });
    }
    if (path === "/api/v1/tasks" && request.method === "GET") { scope(principal, "trace:read"); return json(200, { tasks: (await this.options.store.listTasks()).map(taskResponse) }); }
    let match = /^\/api\/v1\/tasks\/([^/]+)$/u.exec(path);
    if (match && request.method === "GET") { scope(principal, "trace:read"); const task = await this.options.store.getTask(segment(match[1]!)); return task ? json(200, { task: taskResponse(task) }) : missing("task"); }
    if (path === "/api/v1/runs/latest" && request.method === "GET") { scope(principal,"trace:read"); const run=await this.options.store.getLatestRun?.(); return run?json(200,{run}):missing("run"); }
    match = /^\/api\/v1\/runs\/([^/]+)$/u.exec(path);
    if (match && request.method === "GET") { scope(principal, "trace:read"); const run = await this.options.store.getRun(segment(match[1]!)); return run ? json(200, { run }) : missing("run"); }
    if (path === "/api/v1/activities/latest" && request.method === "GET") { scope(principal,"trace:read"); if(!this.options.store.listLatestActivities)return unavailable(); const url=new URL(request.url),raw=Number(url.searchParams.get("limit")??50),limit=Number.isSafeInteger(raw)&&raw>0?Math.min(raw,200):50,runId=url.searchParams.get("runId")??undefined; return json(200,{activities:await this.options.store.listLatestActivities(limit,runId)}); }
    match = /^\/api\/v1\/runs\/([^/]+)\/events$/u.exec(path);
    if (match && request.method === "GET") { scope(principal, "trace:read"); return json(200, { events: (await this.options.store.listRunEvents(segment(match[1]!))).map(eventResponse) }); }
    match = /^\/api\/v1\/runs\/([^/]+)\/(agents|models|commands|tests)$/u.exec(path);
    if (match && request.method === "GET") { scope(principal, "trace:read"); const events = await this.options.store.listRunEvents(segment(match[1]!)); return json(200, runFacet(match[2]!, events)); }
    match = /^\/api\/v1\/runs\/([^/]+)\/resources$/u.exec(path);
    if (match && request.method === "GET") { scope(principal, "trace:read"); const events = await this.options.store.listRunEvents(segment(match[1]!)); const resources: ResourceDto[] = events.filter((e) => e.eventType === "RESOURCE_ACCESSED").map((e) => ({ eventId: e.eventId, sequence: e.sequence, resourceType: e.payload.resourceType, uri: e.payload.uri, evidence: e.source.evidence })); return json(200, { resources }); }
    match = /^\/api\/v1\/runs\/([^/]+)\/artifacts$/u.exec(path);
    if (match && request.method === "GET") { scope(principal, "trace:read"); return json(200, { artifacts: (await this.options.store.listRunArtifacts(segment(match[1]!))).map(artifactResponse) }); }
    match = /^\/api\/v1\/runs\/([^/]+)\/verify$/u.exec(path);
    if (match && request.method === "POST") { scope(principal, "trace:verify"); const events = await this.options.store.listRunEvents(segment(match[1]!)); return json(200, { verification: verifyEventChain(events) }); }
    match = /^\/api\/v1\/artifacts\/([^/]+)$/u.exec(path);
    if (match && request.method === "GET") { scope(principal, "trace:read"); const artifact = await this.options.store.getArtifact(segment(match[1]!)); return artifact ? json(200, { artifact: artifactResponse(artifact) }) : missing("artifact"); }
    match = /^\/api\/v1\/artifacts\/([^/]+)\/verify$/u.exec(path);
    if (match && request.method === "GET") { scope(principal, "trace:verify"); const artifact = await this.options.store.getArtifact(segment(match[1]!)); if (!artifact) return missing("artifact"); const content = await this.options.store.getArtifactContent(artifact.contentHash); const actual = content ? sha256(content) : null; return json(200, { verification: { status: actual === null ? "UNVERIFIED" : actual === artifact.contentHash ? "VERIFIED" : "TAMPERED", expectedHash: artifact.contentHash, actualHash: actual } }); }
    match = /^\/api\/v1\/artifacts\/([^/]+)\/content$/u.exec(path);
    if (match && request.method === "GET") { scope(principal, "artifact:read"); const artifact = await this.options.store.getArtifact(segment(match[1]!)); if (!artifact) return missing("artifact"); const content = await this.options.store.getArtifactContent(artifact.contentHash); if (!content) return missing("artifact content"); if (sha256(content)!==artifact.contentHash) throw new ApiError(409,"INTEGRITY_FAILED","Artifact content failed integrity verification"); return new Response(content,{status:200,headers:{"cache-control":"no-store","content-type":artifact.mimeType,"content-disposition":`attachment; filename="${safeFilename(artifact.relativePath)}"`,"x-content-type-options":"nosniff"}}); }
    if (path === "/api/v1/approvals" && request.method === "POST") { scope(principal, "approval:write"); const input = approvalDto(await bodyJson(request, this.maxBody())); return json(201, { approval: approvalResponse(await this.options.store.createApproval({ ...input, reviewer: principal.subject })) }); }
    match = /^\/api\/v1\/commits\/([^/]+)\/provenance$/u.exec(path);
    if (match && request.method === "GET") { scope(principal, "trace:read"); const value = await this.options.store.getCommit(segment(match[1]!)); return value ? json(200, { commit: commitResponse(value.commit), associations: value.associations }) : missing("commit"); }
    return json(404, { error: { code: "NOT_FOUND", message: "Route not found" } });
  }
  private maxBody(): number { return this.options.maxBodyBytes ?? 64 * 1024; }
  private async finish(request: Request, principal: string, response: Response): Promise<Response> { await this.options.audit?.record({ principal, method: request.method, path: new URL(request.url).pathname, status: response.status, occurredAt: (this.options.now?.() ?? new Date()).toISOString() }); return response; }
}

class ApiError extends Error { public constructor(public readonly status: number, public readonly code: string, message: string) { super(message); } }
function scope(principal: ApiPrincipal, required: ApiScope): void { if (!principal.scopes.includes(required)) throw new ApiError(403, "FORBIDDEN", `Missing required scope: ${required}`); }
async function bodyJson(request: Request, max: number): Promise<unknown> { const bytes = new Uint8Array(await request.arrayBuffer()); if (bytes.byteLength > max) throw new ApiError(413, "BODY_TOO_LARGE", "Request body exceeds the configured limit"); try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON"); } }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "INVALID_DTO", "Request body must be an object"); return value as Record<string, unknown>; }
function field(value: unknown, name: string, max = 2048): string { if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new ApiError(400, "INVALID_DTO", `${name} must be a non-empty string of at most ${max} characters`); return value; }
function taskDto(value: unknown): CreateTaskDto { const v = record(value); return { title: field(v.title, "title", 256), repository: field(v.repository, "repository"), workspace: field(v.workspace, "workspace") }; }
function approvalDto(value: unknown): CreateApprovalDto { const v = record(value), artifactId = typeof v.artifactId === "string" ? field(v.artifactId, "artifactId", 256) : undefined, manifestId = typeof v.manifestId === "string" ? field(v.manifestId, "manifestId", 256) : undefined; if ((artifactId === undefined) === (manifestId === undefined)) throw new ApiError(400, "INVALID_DTO", "Exactly one of artifactId or manifestId is required"); if (!["APPROVED", "REJECTED", "REQUESTED_CHANGES"].includes(String(v.decision))) throw new ApiError(400, "INVALID_DTO", "decision is invalid"); return { runId: field(v.runId, "runId", 256), ...(artifactId ? { artifactId } : { manifestId: manifestId! }), decision: v.decision as CreateApprovalDto["decision"], ...(v.comment === undefined ? {} : { comment: field(v.comment, "comment", 4096) }) }; }
function integrationContextDto(value:unknown):IntegrationContextDto{const v=record(value);return{adapter:field(v.adapter,"adapter",64),externalSessionId:field(v.externalSessionId,"externalSessionId",512),repository:field(v.repository,"repository"),workspace:field(v.workspace,"workspace"),developer:field(v.developer,"developer",256),...(typeof v.agentName==="string"?{agentName:field(v.agentName,"agentName",256)}:{}),...(typeof v.agentVersion==="string"?{agentVersion:field(v.agentVersion,"agentVersion",64)}:{})};}
function integrationEventDto(value:unknown):IntegrationEventDto&{adapter:string;adapterVersion:string}{const v=record(value),actor=record(v.actor),payload=record(v.payload);return{taskId:field(v.taskId,"taskId",256),sessionId:field(v.sessionId,"sessionId",256),runId:field(v.runId,"runId",256),eventType:field(v.eventType,"eventType",64),actor,payload,adapter:field(v.adapter,"adapter",64),adapterVersion:field(v.adapterVersion,"adapterVersion",64),providerEventId:field(v.providerEventId,"providerEventId",1024),evidence:field(v.evidence,"evidence",32),...(typeof v.occurredAt==="string"?{occurredAt:field(v.occurredAt,"occurredAt",64)}:{}),...(typeof v.provider==="string"?{provider:field(v.provider,"provider",256)}:{})};}
function segment(value: string): string { const decoded = decodeURIComponent(value); if (decoded.trim() === "" || decoded.length > 256) throw new ApiError(400, "INVALID_PATH", "Path identifier is invalid"); return decoded; }
function json(status: number, value: unknown, headers: Record<string, string> = {}): Response { return Response.json(value, { status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", ...headers } }); }
function missing(name: string): Response { return json(404, { error: { code: "NOT_FOUND", message: `${name} not found` } }); }
function unavailable():Response{return json(503,{error:{code:"INGESTION_UNAVAILABLE",message:"Event ingestion is not configured"}});}
function taskResponse(v: any) { return { taskId: v.taskId, title: v.title, repository: v.repository, workspace: v.workspace, createdAt: v.createdAt, createdBy: v.createdBy, status: v.status }; }
function eventResponse(v: any) { return { eventId: v.eventId, runId: v.runId, taskId: v.taskId, sessionId: v.sessionId, sequence: v.sequence, eventType: v.eventType, actor: v.actor, occurredAt: v.occurredAt, recordedAt: v.recordedAt, source: { adapter:v.source.adapter, provider:v.source.provider, evidence:v.source.evidence }, payload: v.payload, previousEventHash: v.previousEventHash, eventHash: v.eventHash }; }
function artifactResponse(v: any) { return { artifactId: v.artifactId, runId: v.runId, artifactType: v.artifactType, relativePath: v.relativePath, mimeType: v.mimeType, size: v.size, contentHash: v.contentHash, hashAlgorithm: v.hashAlgorithm, createdAt: v.createdAt, createdByAgent: v.createdByAgent }; }
function approvalResponse(v: any) { return { approvalId: v.approvalId, runId: v.runId, target: v.target, reviewer: v.reviewer, decision: v.decision, timestamp: v.timestamp, comment: v.comment }; }
function commitResponse(v: any) { return { repository: v.repository, branch: v.branch, baseCommit: v.baseCommit, commitId: v.commitId, author: v.author, authorEmail: v.authorEmail, timestamp: v.timestamp, changedFiles: v.changedFiles }; }
function runFacet(facet:string,events:readonly any[]):Record<string,unknown>{
  if(facet==="agents"){const values=new Map<string,unknown>();for(const event of events.filter(e=>String(e.eventType).startsWith("AGENT_"))){const id=String(event.actor.id??event.payload.agentId??event.actor.name??"unknown");values.set(id,{agentId:id,name:event.actor.name??event.payload.agentName??null,eventType:event.eventType,evidence:event.source.evidence});}return{agents:[...values.values()]};}
  if(facet==="models")return{modelInvocations:events.filter(e=>["MODEL_REQUEST","MODEL_RESPONSE","MODEL_ERROR"].includes(e.eventType)).map(e=>({eventId:e.eventId,sequence:e.sequence,eventType:e.eventType,provider:e.source.provider??null,invocationId:e.payload.invocationId??null,model:e.payload.model??e.actor.name??null,inputTokens:e.payload.inputTokens??null,outputTokens:e.payload.outputTokens??null,evidence:e.source.evidence}))};
  if(facet==="commands")return{commands:events.filter(e=>String(e.eventType).startsWith("TERMINAL_COMMAND_")).map(e=>({eventId:e.eventId,sequence:e.sequence,eventType:e.eventType,command:e.payload.command??null,workingDirectory:e.payload.workingDirectory??null,exitCode:e.payload.exitCode??null,evidence:e.source.evidence}))};
  return{tests:events.filter(e=>String(e.eventType).startsWith("TEST_")).map(e=>({eventId:e.eventId,sequence:e.sequence,eventType:e.eventType,command:e.payload.command??null,framework:e.payload.framework??null,passed:e.payload.passed??null,failed:e.payload.failed??null,skipped:e.payload.skipped??null,exitCode:e.payload.exitCode??null,evidence:e.source.evidence}))};
}
function safeFilename(path:string):string{const value=path.split(/[\\/]/u).pop()?.replace(/[^A-Za-z0-9._-]/gu,"_")??"artifact";return value.slice(0,180)||"artifact";}
