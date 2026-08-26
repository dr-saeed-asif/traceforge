# TraceForge SDK

The SDK emits provider-neutral events through `TraceTransport`. `CollectorTraceTransport` connects it to the local collector and artifact-store ports. Future HTTP transport can implement the same contract without changing run instrumentation.

```typescript
const traceforge = new Traceforge(transport, clock, ids);
const trace = traceforge.startRun({
  task: "Create user form",
  repository: "example/repository",
  workspace: "/workspace",
  developer: "developer-id",
  agent: { id: "agent-id", name: "Custom Agent", version: "1.0.0" }
});

await trace.recordPrompt("Create a registration form");
await trace.recordToolCall("read-file", { path: "src/page.tsx" }, readPage);
await trace.recordArtifact({
  relativePath: "src/UserForm.tsx",
  mimeType: "text/typescript",
  content: generatedSource
});
await trace.recordApproval({
  target: { artifactId },
  reviewer: "reviewer-id",
  decision: "APPROVED"
});
await trace.complete();
```

## Lifecycle

`startRun` schedules `TASK_CREATED`, `SESSION_STARTED`, and `AGENT_STARTED`. Recording methods wait for initialization and serialize their own emissions. `complete` waits for previously scheduled work and emits `AGENT_COMPLETED`, `RUN_COMPLETED`, and `SESSION_COMPLETED`. Further activity is rejected.

Tool callbacks emit start and completion records. A rejected callback produces a failed tool completion and an `ERROR` event, then rethrows the original error. Captured error messages still pass through collector redaction.

Approval must target exactly one artifact or manifest. Artifact creation and Git commit recording never imply approval. `recordGitCommit` requires a correlation object for the same run and commit, preventing accidental cross-run association.

## Evidence and reasoning

SDK events default to `DECLARED` because the SDK reports what its caller supplies. An adapter may use `OBSERVED` only when it directly observed the activity through an authorized integration surface. Prompt events record hidden reasoning availability as `NOT_AVAILABLE`.

Prompt hashes are computed by the collector after redaction and therefore protect the persisted representation, not discarded plaintext. Artifact hashes cover raw stored bytes.
