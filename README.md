# TraceForge

TraceForge ab ek minimal OpenCode prompt capture service hai.

Ye do jagah output save karta hai:

- MySQL table: `traceforge.prompt_results`
- Folder output: `opencode-activity-captures/`

<<<<<<< HEAD
## Stored Fields

Har completed prompt ke liye ye 8 fields save hoti hain:
=======
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
>>>>>>> 77d0ac5dd22531c7fe1d20e068f1a2defb816c14

- `PromptQuery`
- `AgentName`
- `ModelName`
- `Result`
- `Resources`
- `FilePaths`
- `GeneratedCode`
- `EncryptedGeneratedCode`

## Project Structure

| Path | Purpose |
| --- | --- |
<<<<<<< HEAD
| `src/server.ts` | Minimal HTTP API |
| `src/prompt-store.ts` | Prompt aggregation + MySQL insert + capture files |
| `src/migrate.ts` | MySQL migration runner |
| `packages/adapter-opencode/` | OpenCode plugin |
| `infrastructure/mysql-migrations/` | MySQL schema |
| `opencode-activity-captures/` | Prompt-wise JSON capture output |
=======
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
>>>>>>> 77d0ac5dd22531c7fe1d20e068f1a2defb816c14

## Requirements

- Node.js 22+
- MySQL 8+

## Environment

Use `.env`:

```env
DATABASE_URL=mysql://root:1234@127.0.0.1:3306/traceforge
TRACEFORGE_API_URL=http://127.0.0.1:8080
TRACEFORGE_HOST=127.0.0.1
TRACEFORGE_PORT=8080
TRACEFORGE_API_TOKEN=traceforge-local-dev-token-change-me
TRACEFORGE_GENERATED_CODE_PRIVATE_KEY=<base64-encoded-32-byte-key>
```

## Install

```powershell
npm install
npm run build
```

## Create Table

```powershell
<<<<<<< HEAD
=======
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
>>>>>>> 77d0ac5dd22531c7fe1d20e068f1a2defb816c14
npm run db:migrate
```

This creates:

```sql
prompt_results(
  PromptQuery,
  AgentName,
  ModelName,
  Result,
  Resources,
  FilePaths,
  GeneratedCode,
  EncryptedGeneratedCode
)
```

<<<<<<< HEAD
## Start API
=======
Apply `infrastructure/database/runtime-permissions.sql` separately as a MySQL administrator. It creates roles without login credentials and grants the runtime role no update or delete privilege on provenance events. Deployment tooling is responsible for login roles and secret-managed passwords. MySQL Workbench can connect to the same host, port, database, and credentials in `DATABASE_URL`.
>>>>>>> 77d0ac5dd22531c7fe1d20e068f1a2defb816c14

```powershell
npm run api:start
```

Safer option:

```powershell
npm run api:up
```

Ye pehle migration run karta hai, phir server start karta hai.

Health check:

```text
http://127.0.0.1:8080/healthz
```

<<<<<<< HEAD
## OpenCode Setup
=======
- Hosted-provider gateways require callers to supply authentication and provider-version headers; no credentials are persisted by the adapters.
- MySQL integration tests require an externally available MySQL database and skip when `TEST_DATABASE_URL` is absent.
- Local encryption and anchor keys must be supplied outside source control; production uses AWS workload credentials and an explicitly configured KMS key.
- Hash chains alone do not detect deletion of an unanchored chain suffix.
- Automatic secret detection is defense in depth, not a guarantee that arbitrary secrets are recognizable.
- Gateway capture covers only calls deliberately routed through TraceForge; SDK traffic that bypasses the gateway is not observable.
>>>>>>> 77d0ac5dd22531c7fe1d20e068f1a2defb816c14

Project `opencode.json` should load:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///H:/aqibDev/opencode-works/TraceForge/packages/adapter-opencode/dist/operational-plugin.js"
  ]
}
```

If needed before running `opencode`:

```powershell
$env:TRACEFORGE_RUNTIME_ENV="H:\aqibDev\opencode-works\TraceForge\.env"
```

## Workflow

When a prompt is sent:

1. OpenCode plugin sends `PROMPT_SUBMITTED`
2. Plugin sends `AGENT_STARTED`
3. Plugin sends `MODEL_REQUEST`
4. Response text is sent as `MODEL_RESPONSE`
5. `webfetch` URLs are sent as `RESOURCE_ACCESSED`
6. On completion, TraceForge writes:
   - one row into `prompt_results`
   - one folder into `opencode-activity-captures/`

## MySQL Query

```sql
SELECT PromptQuery, AgentName, ModelName, Result, Resources, FilePaths, GeneratedCode, EncryptedGeneratedCode
FROM traceforge.prompt_results;
```

Decrypt generated code for an exact prompt query:

```powershell
npm run code:decrypt -- "Create app"
```

Generate the private encryption key once if `.env` does not already contain it:

```powershell
npm run key:generate
```

## Capture Folder Output

Each completed prompt gets a folder like:

```text
opencode-activity-captures/
  <run-id>--0001--<prompt-slug>/
    README.md
    summary.json
    prompt.json
    resources.json
    generated-code.json
    events/
      000001--PROMPT_SUBMITTED--....json
      000002--MODEL_RESPONSE--....json
```

Root file:

```text
opencode-activity-captures/index.json
```

## Test

```powershell
npm test
```
