# TraceForge Verification System

This document is the single reference for TraceForge verification Phases 1
through 7.7. The system captures immutable execution evidence, extracts
objective claims from a stable final assistant response, verifies those claims
with deterministic rules, exposes a read-only API, and renders the results in a
secure web application.

## End-to-end architecture

```text
OpenCode prompt and tool events
  -> durable PromptStore journal / replay boundary
  -> redaction and canonical event mapping
  -> execution_sessions + immutable trace_events
  -> legacy prompt_results finalization
  -> asynchronous atomic claim extraction
  -> deterministic rule registry
  -> persisted verdicts, reasons, evidence IDs and session scores
  -> authenticated Phase 5 read API
  -> server-rendered Next.js verification console
```

The existing `prompt_results` workflow remains backward-compatible. The
verification model adds evidence and decisions alongside it rather than
replacing it.

## Frozen contracts

### Prompt boundary

`promptId` is the canonical boundary for one user query. One external agent or
chat session may contain multiple prompts, but evidence and claims are never
verified across prompt IDs.

### Verdicts

- `VERIFIED`: current direct evidence satisfies the rule.
- `CONTRADICTED`: current direct negative evidence conflicts with the claim.
- `UNSUPPORTED`: a rule exists, but sufficient relevant evidence is missing or
  stale.
- `UNVERIFIABLE`: no deterministic rule is available.

### Claim-type allowlist

Claims describe propositions; they are not evidence events:

- `FILE_CREATED`
- `FILE_MODIFIED`
- `STRUCTURE_CREATED`
- `DEPENDENCY_RULE`
- `COMMAND_SUCCEEDED`
- `BUILD_PASSED`
- `TEST_PASSED`
- `TASK_COMPLETED`

### Trace-event taxonomy

Events describe observed facts in the past tense:

- Lifecycle: `PROMPT_SUBMITTED`, `AGENT_STARTED`, `FINAL_RESPONSE_CAPTURED`,
  `AGENT_COMPLETED`, `AGENT_FAILED`, `SESSION_COMPLETED`
- Model/resource: `MODEL_REQUESTED`, `RESOURCE_ACCESSED`, `FILE_READ`
- Filesystem: `FILE_CREATED`, `FILE_MODIFIED`, `FILE_DELETED`,
  `DIRECTORY_CREATED`
- Commands: `COMMAND_STARTED`, `COMMAND_COMPLETED`, `BUILD_COMPLETED`,
  `TEST_COMPLETED`, `ARCHITECTURE_CHECK_COMPLETED`

For example, `TEST_PASSED` is a claim type, while `TEST_COMPLETED` is an
evidence event that can prove or contradict it.

### Claim-to-event policy

- File claims use successful file/directory events and before/after existence
  or hash state.
- Dependency claims use successful architecture checks with no violations.
- Command, build and test claims use their corresponding completion events,
  exit codes and parsed test counts.
- `TASK_COMPLETED` is aggregate: a completion event alone cannot prove it; all
  relevant objective child claims must be verified.

### Reliability and coverage

```text
reliability = verified / (verified + contradicted + unsupported) * 100
coverage    = (verified + contradicted + unsupported) / total claims * 100
```

Reliability is `null` when there are no scoreable objective claims. Coverage is
`null` when no claims were extracted. `UNVERIFIABLE` affects coverage but is
excluded from the reliability denominator.

## Persistence and integrity

SQLite migration `infrastructure/sqlite-migrations/001_initial_schema.sql`
creates the legacy `prompt_results` projection and three verification tables:

- `execution_sessions`: one idempotent row per `prompt_id`, lifecycle status,
  processing status, counters, reliability and coverage.
- `trace_events`: append-only, ordered evidence with typed projections,
  redacted metadata and a SHA-256 hash chain.
- `agent_claims`: one-based atomic claims, extraction provenance, nullable
  verification fields, verdict reason, rule version and evidence event IDs.

The schema includes the `(started_at, id)` index used by newest-first session
reads and date filtering.

Each incoming evidence event is persisted immediately. Inside a SQLite
`BEGIN IMMEDIATE` transaction, the repository checks source-event idempotency,
assigns the next sequence, loads the previous hash, canonicalizes the redacted
event, calculates the new hash and inserts the immutable row. Session completion
is processed only after earlier queued events have persisted. Foreign keys,
WAL mode and a bounded busy timeout are enabled whenever the database opens.

Uniqueness constraints make session creation, event replay and claim insertion
retry-safe. Foreign keys use `RESTRICT`; evidence cannot disappear through an
accidental cascade. There are no trace-event update or delete repository
methods. Any future retention deletion must be an explicit audited operation.

## Capture, redaction and retention

The OpenCode adapter captures:

- writable target existence and hashes before tool execution;
- after-state existence and hashes for create/modify/delete classification;
- command, working directory, exit code, bounded output digest and metadata;
- parsed passed, failed and skipped test counts; and
- structured command, build and test completion events.

The durable journal remains the first replay boundary. Verification insertion
is idempotent, so delivery retries do not duplicate evidence.

Sensitive and oversized material is removed before canonical persistence.
`.env*`, credentials, token-like values, binary data, oversized files and
outside-workspace paths are excluded or redacted. Raw responses, command output
and source code are represented in verification metadata by bounded facts,
lengths and SHA-256 digests. Legacy generated-code encryption and capture
behavior remains separate and backward-compatible.

## Claim extraction

Extraction begins only after the final assistant response is stable. The
worker loads the response, splits it into atomic statements, removes opinions,
future plans and duplicates, produces allowlisted structured claims, validates
the strict schema and stores the extractor model plus prompt version.

`ClaimExtractor` is an application port. The conservative local
`HeuristicClaimExtractor` works without an external credential; a future LLM
adapter can implement the same interface. Extractors receive neither trace
events nor verdict labels and never decide a verdict.

## Deterministic verification

The executable rule registry is keyed by claim type. Production verification
reloads immutable events constrained by `prompt_id` and filters the evidence
boundary again before executing a rule. Policy version `2.0.0` stores every
decision with a stable reason code, explanation, evidence event IDs and
verification timestamp.

Sequence numbers establish authority. The latest relevant event wins, and the
last `FINAL_RESPONSE_CAPTURED` sequence provides the before/after claim timing
boundary. A successful build or test becomes stale after a later successful
file create, modification, deletion or directory creation; a newer rerun can
become authoritative again.

Direct negative evidence has priority. Non-zero exits, failed outcomes, failed
test counts, deletions, unchanged hashes or forbidden dependencies produce
`CONTRADICTED`. Missing evidence produces `UNSUPPORTED`; a missing rule produces
`UNVERIFIABLE`.

## Read-only verification API

All endpoints require `Authorization: Bearer <TRACEFORGE_API_TOKEN>`:

- `GET /api/v1/verification/overview`
- `GET /api/v1/verification/sessions`
- `GET /api/v1/verification/sessions/:promptId`

List endpoints accept `limit` from 1–100, a non-negative `offset`, and ISO-8601
`startedAfter`/`startedBefore` bounds. The lower bound is inclusive and the
upper bound exclusive. Sessions are ordered newest first by start time and then
database identity.

The detail endpoint returns a session summary, claims and ordered trace events.
It exposes typed file, command, test and hash projections—not raw prompt
responses, generated code or encrypted artifact bytes. Invalid input returns
HTTP 400, a missing session returns 404, and unexpected failures return a
generic 500 without persistence details.

## Frontend application

`apps/web` is a Next.js App Router workspace using strict TypeScript, ESLint,
Prettier, Vitest, jsdom and Testing Library. `packages/verification-contracts`
owns shared API types and runtime parsers. The API client is server-only, uses
`cache: "no-store"`, applies a bounded timeout, validates every successful
response and never sends the bearer token to browser JavaScript.

Routes:

- `/`: redirects to the session list.
- `/sessions`: 10-date-row URL-based pagination, inclusive UTC date filters,
  daily verification summaries, and a date popup with expandable claim/evidence details,
  agent/model context, claim verdict counts and reliability.
- `/sessions/[promptId]`: session summary, claim verdicts/reasons/explanations,
  bidirectional claim-to-event links, ordered file/command/build/test evidence,
  captured metadata and complete hash-chain information.
- `/api/health`: non-cached frontend-process liveness response.

The responsive application includes a skip link, semantic landmarks, visible
focus states, reduced-motion behavior, horizontally scrollable tables and text
labels in addition to verdict colors.

## Environment and security

Use `apps/web/.env.production.example` as the deployment template:

| Variable                    | Required | Purpose                                          |
| --------------------------- | -------- | ------------------------------------------------ |
| `TRACEFORGE_DATABASE_PATH`  | No       | SQLite file path; default `./data/traceforge.sqlite` |
| `TRACEFORGE_API_URL`        | Yes      | Server-reachable Phase 5 API URL                 |
| `TRACEFORGE_API_TOKEN`      | Yes      | Server-only bearer token, at least 16 characters |
| `TRACEFORGE_API_TIMEOUT_MS` | No       | Upstream timeout from 1–60,000 ms; default 8,000 |

Never use `NEXT_PUBLIC_TRACEFORGE_API_TOKEN`. Production responses include
frame denial, MIME-sniffing protection, a no-referrer policy, restricted browser
permissions and same-origin opener isolation. TLS, secret rotation, network
controls and log redaction remain deployment-platform responsibilities.

## Verification and deployment

Run from the repository root:

```powershell
npm run contracts:typecheck
npm run contracts:test
npm run web:quality
npm run web:test:e2e
npm run web:build
```

The complete frontend release gate is:

```powershell
npm run web:verify:production
```

The dependency-free E2E runner starts an isolated mock API and temporary Next.js
server, then exercises overview, date-filtered sessions, invalid filters and a
claim/evidence investigation over HTTP. GitHub Actions runs the contract checks
and the same frontend release gate.

Production deployment:

1. Use Node.js 22.22.2 or newer and install the lockfile with `npm ci`.
2. Configure the protected server environment variables.
3. Set `TRACEFORGE_DATABASE_PATH` to persistent local storage and run
   `npm run db:migrate`. The API also applies pending migrations at startup.
4. Run the contract checks and `npm run web:verify:production`.
5. Start with `npm run web:start` behind a TLS reverse proxy.
6. Probe `/api/health`, then smoke-test `/`, `/sessions` and a known detail
   route.

### One-time MySQL import

To retain an existing installation, keep the old MySQL `DATABASE_URL`, set
`TRACEFORGE_DATABASE_PATH` to a new SQLite file, stop the API, and run:

```powershell
npm run db:import:mysql
```

The importer requires an empty SQLite database, preserves record IDs, prompt
boundaries, trace sequence numbers and event hashes, and finishes with SQLite
foreign-key and integrity checks. It never deletes or modifies MySQL data.

The health route confirms only frontend-process liveness. Monitor the API and
database separately. Keep the previous frontend artifact for rollback; the web
application is read-only, so a frontend rollback does not modify verification
data.

Before release, manually inspect 320, 768, 1024 and 1440 pixel widths, keyboard
navigation, visible focus, table scrolling, reduced motion and 200% zoom.
