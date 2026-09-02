# TraceForge

TraceForge is a provider-neutral provenance framework for AI-assisted software development. It records observable, authorized activity and creates tamper-evident event and artifact integrity records. It does **not** claim access to private or hidden model reasoning; unavailable reasoning is represented as `NOT_AVAILABLE`.

## Current status

Phases 1 through 11 are implemented:

- provider-independent domain entities and normalized event envelope;
- deterministic canonical JSON and SHA-256 event chaining;
- event and chain verification with failure diagnostics;
- byte-level artifact hashing and deterministic manifest hashing;
- configurable secret redaction;
- architectural boundary and critical integrity tests.
- validated collector ingress with per-run serialized processing;
- idempotency using explicit, provider, or deterministic content keys;
- bounded queue backpressure and graceful draining;
- sanitized durable buffering and outage replay;
- in-memory event persistence and content-addressed filesystem artifact storage.
- normalized MySQL 8 schema and checksum-protected migration runner;
- transactionally locked event append, idempotency receipt, and outbox insertion;
- lease-based, multi-worker-safe outbox claims;
- append-only event-log permissions for the runtime database role.
- provider-neutral SDK with task, session, run, prompt, model, tool, artifact, and completion recording;
- collector-backed SDK transport and lifecycle enforcement;
- executable synthetic end-to-end workflow with chain and artifact verification.
- shell-safe Git commit inspection with before, after, and binary-diff hashes;
- evidence-qualified artifact-to-commit correlation;
- explicit artifact or manifest approval/rejection events;
- MySQL approval and commit-provenance query repositories.
- AES-256-GCM envelope encryption with replaceable key-provider contracts;
- encrypted artifact storage with plaintext verification and ciphertext deduplication metadata;
- MySQL encrypted-blob metadata that explicitly forbids plaintext data keys;
- signed, hash-chained local integrity anchoring containing only root hashes and proof metadata.
- OpenCode 1.18.21 plugin adapter compiled against the official hook types;
- observed prompt, provider/model, response metadata, tool, bash, file-diff, resource, and visible-part mappings;
- explicit OpenCode capability matrix and provider-neutral collector bridge.
- Ollama `/api/chat` and `/api/generate` wrapper with bounded streaming capture;
- non-destructive response cloning and an explicit provenance-completion promise;
- observed response metrics and model-requested tool calls without claiming tool execution.
- provider-neutral hosted-model gateway contract with isolated OpenAI Responses, Anthropic Messages, and DeepSeek Chat Completions profiles;
- JSON and SSE response normalization with non-destructive forwarding, bounded capture, and explicit provenance completion;
- structured tool-call observation without execution claims, and deliberate suppression of provider-exposed reasoning/thinking content.
- versioned framework-neutral REST API handler with bearer authentication and endpoint scopes;
- validated, bounded task and approval DTOs with authenticated identity binding;
- allowlisted task, run, event, resource, artifact, approval, and commit-provenance responses;
- explicit event-chain and artifact-byte verification endpoints with security audit hooks.
- responsive provenance workbench with run integrity, event filtering, artifact verification, approvals, and Git correlation views;
- server-rendered dashboard build for Cloudflare-compatible Sites hosting;
- private hosted dashboard preview with an explicitly labeled demo dataset and production API integration boundary.
- MySQL-backed production API composition with KMS envelope-decrypted artifact access;
- workspace-authenticated dashboard aggregation through a private Sites service binding;
- explicit live, connecting, unavailable, and demo states without silently substituting demo evidence.
- master-prompt event taxonomy including explicit failure, rename, update, unavailable, and not-observed states;
- research completeness scoring and operation-overhead measurement primitives;
- separately authorized, integrity-checked secure artifact content access;
- typed production configuration and structured API audit/error logs.

OpenCode, Ollama, OpenAI, Anthropic, and DeepSeek adapters, the REST API boundary, production composition, and dashboard are implemented. A live installation still requires provisioned MySQL 8, AWS KMS, API credentials, artifact storage, and a Sites private tunnel binding.

## Architecture

Dependencies point inward:

```text
apps/adapters -> application/provenance -> domain
                         |
                         -> crypto
```

The domain package has no provider, database, HTTP, UI, blockchain, or Node runtime dependencies. See [the architecture overview](docs/architecture/overview.md) and [ADRs](docs/adr/).

### Working repository structure

| Path | Purpose |
| --- | --- |
| `packages/domain` | Core event and entity rules with no infrastructure dependencies |
| `packages/application` | Use-case ports implemented by infrastructure adapters |
| `packages/provenance`, `packages/collector` | Redaction, normalization, ordering, hashing, and collection |
| `packages/database`, `packages/crypto`, `packages/git`, `packages/anchor` | Infrastructure adapters |
| `packages/adapter-*` | OpenCode, Ollama, and hosted-model integration boundaries |
| `packages/api`, `packages/sdk` | Transport-neutral API and client contracts |
| `infrastructure` | MySQL migrations and deployment configuration |
| `scripts` | Operational, migration, smoke-test, documentation, and cleanup commands |
| `docs` | Architecture decisions, API guides, security, and evaluation documentation |
| `opencode-activity-captures` | Runtime prompt-by-prompt evidence projection; preserved by cleanup |
| `examples/login-form` | Generated login-form sample moved out of the application root |

Generated build directories and TypeScript build metadata are excluded from the logical architecture. Run `npm run clean` to remove them; `npm run build` recreates required runtime output.

## Local development

Requirements: Node.js 22 or newer and npm.

```sh
npm install
npm run typecheck
npm test
npm run build
```

### Live OpenCode capture

The local OpenCode configuration loads `packages/adapter-opencode/dist/operational-plugin.js`. Configure it with an external TraceForge-compatible API, then use `opencode` normally from any repository.

The integration captures observable prompts, agent and model lifecycle, token usage, tools, terminal commands, file activity, resources, visible reasoning summaries, errors, and session state. Payloads are redacted, provider events are deduplicated, ingress is durably buffered, and stored events join the tamper-evident hash chain. Hidden model chain-of-thought is deliberately recorded as unavailable.

Validate the complete pipeline without a paid model request:

```powershell
node scripts/smoke-opencode-capture.mjs
```

Start the central MySQL-backed ingestion API after configuring `.traceforge/operational/runtime.env`:

```powershell
docker compose --env-file .env -f infrastructure/docker/compose.yml up -d
npm run api:start
```

The server applies pending migrations, starts the redacting and hash-chaining collector, and listens on `TRACEFORGE_HOST:TRACEFORGE_PORT` (defaults `127.0.0.1:8080`). `GET /healthz` is unauthenticated; all `/api/v1/*` routes require the configured bearer token. Independent projects load `packages/adapter-opencode/dist/operational-plugin.js` from their project-local `opencode.json` and send events to this API.

The hosted dashboard continues to show its clearly labeled demo data when no live run/API binding is supplied. With the private API binding configured, open it using `?runId=<captured-run-id>` to render that run from MySQL.

### MySQL development

For a local MySQL 8 instance or the included Docker service:

```sh
docker compose --env-file .env -f infrastructure/docker/compose.yml up -d
npm run db:migrate
```

The migration command requires `DATABASE_URL`. Database integration tests require `TEST_DATABASE_URL`; they skip explicitly when it is absent:

```sh
npm test
```

Apply `infrastructure/database/runtime-permissions.sql` separately as a MySQL administrator. It creates roles without login credentials and grants the runtime role no update or delete privilege on provenance events. Deployment tooling is responsible for login roles and secret-managed passwords. MySQL Workbench can connect to the same host, port, database, and credentials in `DATABASE_URL`.

## Integrity verification

Each event includes the preceding event hash. The event hash is SHA-256 over the preceding hash concatenated with canonical JSON for the event without `eventHash`. Verification reports `VERIFIED`, `TAMPERED`, `INCOMPLETE`, or `UNVERIFIED` and identifies the failing event when possible.

Artifacts are hashed from raw bytes. Manifests hash a deterministic ordered representation of artifact IDs, paths, sizes, and hashes. Hashes prove byte consistency, not that a producer's assertion was truthful.

## Security model

Secret redaction happens before durable buffering, persistence, or hashing. Rules inspect both value patterns and structured sensitive field names. Artifact storage supports authenticated envelope encryption through replaceable key-provider contracts. See [the initial threat model](docs/threat-model/initial-threat-model.md).

## Limitations

- Hosted-provider gateways require callers to supply authentication and provider-version headers; no credentials are persisted by the adapters.
- MySQL integration tests require an externally available MySQL database and skip when `TEST_DATABASE_URL` is absent.
- Local encryption and anchor keys must be supplied outside source control; production uses AWS workload credentials and an explicitly configured KMS key.
- Hash chains alone do not detect deletion of an unanchored chain suffix.
- Automatic secret detection is defense in depth, not a guarantee that arbitrary secrets are recognizable.
- Gateway capture covers only calls deliberately routed through TraceForge; SDK traffic that bypasses the gateway is not observable.

## Production composition

TraceForge now ships library and plugin packages only. Deploying an HTTP composition root or dashboard is the responsibility of a separate consuming project.
