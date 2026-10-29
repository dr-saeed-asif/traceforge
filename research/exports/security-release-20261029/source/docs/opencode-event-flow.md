# OpenCode capture flow

Verified on 2026-09-12 against the local runtime at `E:\opencode\opencode`, running from `E:\PhD Data\opencode-work\Logistics`.

## Runtime and registration

The runtime is the event source. Paths below are relative to its `packages/opencode/src` directory:

| Source | Emission |
| --- | --- |
| `session/prompt.ts` (`createUserMessage`) | Calls `plugin.trigger("chat.message", input, { message, parts })`. |
| `session/status.ts` (`set`) | Publishes `session.idle` when status is idle. |
| `session/session.ts` (`remove`) | Publishes `session.deleted` before removing the session's events. |
| `session/session.ts` (`updatePart`) | Publishes `message.part.updated` with a cloned part, session ID, and timestamp. |
| `session/tools.ts` | Calls `tool.execute.before`, executes the tool, then calls `tool.execute.after` with arguments and output. Other tool paths also invoke these hooks. |
| `event-v2-bridge.ts` | Attaches the instance location to published events. |
| `plugin/index.ts` | Loads external plugins, awaits direct hooks, and dispatches generic events to hooks for the matching directory. Generic event callbacks are not awaited. |

`Logistics/opencode.json` registers this external plugin:

```text
file:///E:/PhD%20Data/opencode-work/traceforge/packages/adapter-opencode/dist/operational-plugin.js
```

The config registers the plugin; it does not capture events. The authoritative plugin source is `packages/adapter-opencode/src/operational-plugin.ts`. `npm run build` regenerates the registered JavaScript and its source map.

## Hook contract

| Hook / condition | Event | Payload | Optional actor |
| --- | --- | --- | --- |
| `chat.message`, first | `PROMPT_SUBMITTED` | `{ content, agent, model, gitUser }` | — |
| `chat.message`, second | `AGENT_STARTED` | `{ agentName }` | `{ name: agent }` |
| `chat.message`, third | `MODEL_REQUEST` | `{ model, provider }` | `{ name: modelID }` |
| `event`, `session.idle` | `AGENT_COMPLETED` | `{ status: "COMPLETED" }` | — |
| `event`, `session.deleted` | `SESSION_COMPLETED` | `{ status: "COMPLETED" }` | — |
| `event`, completed text part | `MODEL_RESPONSE` | `{ responseText }` | — |
| `tool.execute.after`, recognized target | `RESOURCE_ACCESSED` | Existing file/directory/webpage/search/skill resource object | — |
| `tool.execute.after`, eligible written file | `GENERATED_CODE_CAPTURED` | `{ path, code, operation }` | — |

Completed text means `type === "text"`, string `text`, and `time.end !== undefined`. The plugin does not add a message-role filter. Session deletion is distinct from an ordinary idle completion. Resource captures precede generated-code captures within each tool hook.

## Capture helpers, in call-flow order

1. `contextFor`: caches one context promise per external session ID, including failed promises.
2. `capture`: awaits the context, spreads it into the event body, and catches/logs capture errors.
3. `post`: sends bearer-authenticated JSON, uses a 10-second timeout, requires a successful HTTP response, and parses JSON.
4. `loadSettings`: starts with `process.env`, then overlays the selected environment file. `TRACEFORGE_RUNTIME_ENV` selects that file; otherwise it is the TraceForge root `.env` relative to the compiled plugin.
5. `sessionIdOf`: tries `properties.sessionID`, `info.sessionID`, `info.id`, then `part.sessionID`.
6. `resourcesForTool`: normalizes tool names and extracts the existing resource payloads from tool arguments. Unknown tools produce no resources.
7. `generatedCodeFor`: reads written files after execution. Excludes paths outside the workspace, sensitive paths, files over 1 MiB, NUL-containing files, invalid UTF-8, and unreadable/deleted files.
8. `getGitIdentity`: tries project/process-cwd Git configuration, then global configuration, preserving the paired-command error handling and `NOT_AVAILABLE` fallback. Standard chat input has no directory/worktree fields, so its existing lookup uses the process cwd.
9. `isSensitivePath`: recognizes `.git`, `node_modules`, `.env`, and `.env.*` path segments.
10. `workspacePath`: preserves existing relative/absolute path selection and slash normalization.
11. `patchPaths`: extracts Add/Update/Delete markers and unified-diff paths, deduplicates them, and excludes `/dev/null`.
12. `firstString`: selects the first nonblank string from the supplied keys and trims it.
13. `isRecord`: accepts non-null, non-array objects.

## API and persistence

The base is `TRACEFORGE_API_URL`, falling back to `http://127.0.0.1:8080`. The verified installation configures `http://localhost:8080` and listens on IPv6 localhost.

```text
POST /api/v1/integrations/context
  { externalSessionId }
  -> { context: { taskId, sessionId, runId } }

POST /api/v1/integrations/events
  { ...context, eventType, payload, ...(actor ? { actor } : {}) }
```

`src/server.ts` passes accepted events to `PromptStore`. `src/prompt-store.ts` queues ingestion per run and finalizes on terminal events. The insert continues to use exactly:

`PromptQuery`, `AgentName`, `ModelName`, `Result`, `Resources`, `FilePaths`, `GeneratedCode`, `EncryptedGeneratedCode`, `GitUser`.

The database supplies `created_at` (`CURRENT_TIMESTAMP`) and `created_by` (`NOT_AVAILABLE`); the existing auto-increment `id` is also preserved. JSON serialization, response aggregation, resource deduplication, latest-generated-file selection, and the AES-256-GCM envelope remain unchanged.

## Execution evidence

- Built from the local runtime package using `bun run build --single --skip-install --skip-embed-web-ui`.
- Native binary: `E:\opencode\opencode\packages\opencode\dist\opencode-windows-x64\bin\opencode.exe`.
- Build/smoke-test version: `0.0.0-dev-202609121107`.
- Baseline and post-refactor runs used `run --model openai/gpt-5.6-sol --agent build --format json` from Logistics, with the registered plugin enabled.
- Both successful runs read `README.md` and created `traceforge-validation.txt` using `apply_patch`. Both returned `TRACEFORGE_VALIDATION_OK`.
- Baseline database row: **4**, session `ses_f6ab11563ffeHIH0TnLNatjZvZ`.
- Post-refactor database row: **7**, session `ses_f6aab7d60ffeB1L1XJge5izHDy`.
- Exact schema comparison passed. Result, agent/model, resources, paths, generated code, Git identity, and creator default matched. Prompt differences were the validation marker and explicit naming of `apply_patch` in the retry. Timestamps/IDs differ normally; each encrypted value decrypted to the corresponding `GeneratedCode`.
- Both saved captures contained the same eight-event sequence: `PROMPT_SUBMITTED`, `AGENT_STARTED`, `MODEL_REQUEST`, two `RESOURCE_ACCESSED` events, `GENERATED_CODE_CAPTURED`, `MODEL_RESPONSE`, `AGENT_COMPLETED`. Payloads matched after accounting for the submitted prompt differences.
- A separate real local-runtime create/delete operation emitted `SESSION_COMPLETED`; a temporary forwarding observer verified context attachment and TraceForge's HTTP **202** response. The observer and validation server were stopped afterward.
- An isolated HTTP contract comparison made **27 identical requests** before/after, exercising all hooks, context caching, tool aliases, patch paths, and capture exclusions.
- `npm run typecheck`, `npm run build`, and all **7** existing tests passed.

Validation rows and activity captures were retained. An unsupported-model attempt, a diagnostic prompt, and an initial post-change prompt that requested an unavailable `write` tool also left validation rows; these were not used for the successful comparison. The temporary generated file was removed after verification.

Quit and restart existing OpenCode sessions to load the rebuilt plugin.
