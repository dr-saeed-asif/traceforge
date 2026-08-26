# REST API v1

`@traceforge/api` provides a framework-neutral handler accepting standard Fetch API `Request` objects and returning `Response` objects. Deployment composition supplies a `TraceForgeApiStore`, authenticator, and optional audit sink; the API never exposes persistence records directly.

## Authentication and authorization

Every route requires `Authorization: Bearer <token>`. The included static authenticator stores only SHA-256 token digests and compares them in constant time. Production composition can replace it with an identity-provider adapter.

Scopes are explicit:

- `trace:read` reads tasks, runs, events, resources, artifacts, and commit provenance;
- `trace:write` creates tasks;
- `trace:verify` verifies event chains and artifact bytes;
- `artifact:read` decrypts, verifies, and returns authorized artifact content;
- `approval:write` creates approvals.

Approval reviewer and task creator identities come from the authenticated principal, never request fields. Audit records contain principal, method, path, status, and time, but no authorization header or body.

## Routes

```text
POST /api/v1/tasks
GET  /api/v1/tasks
GET  /api/v1/tasks/:taskId
GET  /api/v1/runs/:runId
GET  /api/v1/runs/:runId/events
GET  /api/v1/runs/:runId/agents
GET  /api/v1/runs/:runId/models
GET  /api/v1/runs/:runId/resources
GET  /api/v1/runs/:runId/artifacts
GET  /api/v1/runs/:runId/commands
GET  /api/v1/runs/:runId/tests
POST /api/v1/runs/:runId/verify
GET  /api/v1/artifacts/:artifactId
GET  /api/v1/artifacts/:artifactId/verify
GET  /api/v1/artifacts/:artifactId/content
POST /api/v1/approvals
GET  /api/v1/commits/:commitId/provenance
```

JSON bodies default to a 64 KiB limit. DTO strings have field-specific limits. Errors use `{ "error": { "code", "message" } }`; internal exceptions are not returned to clients. Responses use allowlisted fields, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. Artifact metadata omits its internal storage reference. Content retrieval is separately scoped, decrypts through the configured artifact store, verifies SHA-256 before returning bytes, and never returns key metadata.
