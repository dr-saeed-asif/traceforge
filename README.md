# TraceForge

**TraceForge verifies what a coding agent says it completed.** It captures OpenCode execution events, extracts atomic claims from the final response, checks those claims against prompt-scoped evidence, and presents the verdicts in a web dashboard.

TraceForge is designed for reproducible research and practical auditing. A local Ollama model extracts claims, but deterministic rules assign verdicts. The model cannot mark its own claims as verified.

## What TraceForge Verifies

| Verdict        | Meaning                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `VERIFIED`     | Required evidence matches the claim.                                           |
| `CONTRADICTED` | Captured evidence directly conflicts with the claim.                           |
| `UNSUPPORTED`  | The claim is checkable, but matching or complete evidence is missing or stale. |
| `UNVERIFIABLE` | No deterministic rule can establish the claim.                                 |

The reliable first-paper scope is file creation/modification, command completion, build results, and test results. A changed file hash proves that a file changed; it does not prove semantic claims such as "the bug is fixed." Those claims require an independent acceptance test and otherwise remain `UNVERIFIABLE`.

---

## Complete System Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐     ┌──────────────────┐
│  OpenCode   │────►│  Adapter Plugin  │────►│  Durable    │────►│   API Server     │
│   Agent     │     │  (operational-   │     │  Outbox     │     │  (server.ts)     │
│             │     │   plugin.ts)     │     │             │     │                  │
└─────────────┘     └──────────────────┘     └─────────────┘     └────────┬─────────┘
                                                                           │
                    ┌──────────────────┐     ┌─────────────┐              │
                    │  Verification    │◄────│  Prompt     │◄─────────────┘
                    │  Pipeline        │     │  Store      │
                    └────────┬─────────┘     └─────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌───────────┐  ┌───────────┐  ┌─────────────┐
       │  Claim    │  │  Evidence │  │  Deterministic│
       │ Extraction│  │  Policy   │  │  Verifier   │
       │(heuristic/│  │(claim-    │  │(8 rules)    │
       │ Ollama)   │  │verification│  │             │
       └───────────┘  │-policy.ts)│  └─────────────┘
                      └───────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   SQLite DB      │
                    │ - trace_events   │
                    │ - agent_claims   │
                    │ - execution_     │
                    │   sessions       │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Next.js Web     │
                    │  Dashboard       │
                    │ (apps/web)       │
                    └──────────────────┘
```

---

## 5 Core Workflows

### 1. Frontend Workflow (Dashboard)

**Key Files:**
- `apps/web/src/lib/traceforge-api/client.ts` - Server-only API client
- `apps/web/src/app/sessions/[promptId]/page.tsx` - Investigation page
- `apps/web/src/features/session-details/claims-table.tsx` - Claims display

**Flow:**
1. **Server Component** calls `createTraceForgeApiClient()` (runs on server, token never in browser)
2. **API Client** fetches from `TRACEFORGE_API_URL` with `Authorization: Bearer <token>`
3. **Endpoints:**
   - `GET /api/v1/verification/session-days` → Daily summary for dashboard
   - `GET /api/v1/verification/sessions` → Paginated prompt list
   - `GET /api/v1/verification/sessions/:promptId` → Full investigation
4. **Response validated** against Zod schemas from `@traceforge/verification-contracts`
5. **UI renders:**
   - Session list with date filters, pagination
   - Investigation: SessionSummary → ClaimsTable → TraceTimeline
   - Clickable evidence links (Claim ↔ Event navigation)

**Security:** `import "server-only"` ensures API token never leaves server.

---

### 2. Plugin Workflow (OpenCode Adapter)

**Key File:** `packages/adapter-opencode/src/operational-plugin.ts`

**Purpose:** Hook into OpenCode → capture events → deliver to TraceForge API reliably.

**4 Main Hooks:**

| Hook | Trigger | Events Emitted |
|------|---------|----------------|
| `chat.message` | User sends query | `PROMPT_SUBMITTED`, `AGENT_STARTED`, `MODEL_REQUEST` |
| `event` | Session lifecycle | `AGENT_COMPLETED`, `SESSION_COMPLETED`, `AGENT_FAILED`, `MODEL_RESPONSE` |
| `tool.execute.before` | Tool starts | `COMMAND_STARTED`, file snapshots (pre-state) |
| `tool.execute.after` | Tool finishes | `COMMAND_COMPLETED`/`TEST_COMPLETED`/`BUILD_COMPLETED`, `RESOURCE_ACCESSED`, `GENERATED_CODE_CAPTURED` |

**Key Mechanisms:**
- **DurableOutbox**: Disk-backed queue (survives crashes, retries on API downtime)
- **Serial queues**: Per-session ordering (OpenCode doesn't await callbacks)
- **File snapshots**: Pre-tool hash + post-tool hash = CREATE/MODIFY/DELETE detection
- **PromptId**: `sha256(projectPath:sessionId:messageId)` for deduplication
- **Sensitive filtering**: `.git`, `node_modules`, `.env*` never captured

**Event Delivery:**
```
OpenCode Hook → capture() → DurableOutbox.enqueue() → POST /api/v1/integrations/events
```

---

### 3. Claim Extraction Workflow

**Key Files:**
- `src/modules/verification/application/claim-extractor.ts` - Heuristic extractor + interfaces
- `src/modules/verification/application/ollama-claim-extractor.ts` - LLM extractor
- `src/modules/verification/application/verification-service.ts` - Orchestrator

**Two Implementations (same interface):**

#### A. HeuristicClaimExtractor (Default, No LLM)
```
finalResponse
    │
    ▼
splitAtomicStatements() ──► "I created file X. Tests passed." → ["I created file X", "Tests passed"]
    │
    ▼
removeNonVerifiableText() ──► Filters: opinions, future plans, vague praise
    │
    ▼
classifyClaimType() ──► Regex match → 1 of 8 types (FILE_CREATED, TEST_PASSED, etc.)
    │
    ▼
extractTargetAndExpectedResult() ──► File paths, commands, expectations
    │
    ▼
expectationFor() ──► { outcome: success/failure, basis: operation/behavior/unverifiable }
    │
    ▼
ExtractedClaim[]
```

#### B. OllamaClaimExtractor (LLM-based)
```
finalResponse
    │
    ▼
buildClaimExtractionPrompt() ──► Detailed system prompt + JSON schema
    │
    ▼
POST http://127.0.0.1:11434/api/chat (Ollama)
    │  - temperature: 0, seed: 42 (deterministic)
    │  - format: CLAIM_SCHEMA (structured output)
    ▼
parseExtractedClaims() ──► VALIDATES: claimText & sourceQuote MUST be exact substrings
    │
    ▼ (if validation fails)
repair() ──► Re-prompt LLM with error + original response
    │
    ▼
normalizeClaims() ──► LLM provides sourceQuote; we locally derive target/expectation
    │
    ▼
ExtractedClaim[]
```

**Claim Types (8):**
- `FILE_CREATED` - "I created utils/helpers.ts"
- `FILE_MODIFIED` - "I updated the config file"
- `STRUCTURE_CREATED` - "I set up domain/application/infrastructure layers"
- `DEPENDENCY_RULE` - "Architecture check passed, no forbidden imports"
- `COMMAND_SUCCEEDED` - "npm run build succeeded"
- `BUILD_PASSED` - "Build completed with exit code 0"
- `TEST_PASSED` - "All 15 tests passed, 0 failed"
- `TASK_COMPLETED` - "Task is done" (aggregate)

**Critical Validation:** `parseExtractedClaims()` requires `claimText` AND `sourceQuote` to be exact substrings of the final response. This prevents hallucination.

---

### 4. Deterministic Verification Workflow

**Key Files:**
- `src/modules/verification/application/claim-verifier.ts` - 8 rules + orchestrator
- `src/modules/verification/application/verification-service.ts` - Pipeline coordinator

**Core Principle:** Separation of concerns. Extractor (LLM) produces claims. Verifier (deterministic rules) judges them. Extractor never sees verdict labels or rules.

**Pipeline (VerificationApplicationService.verifyPrompt):**
```
1. EXTRACT CLAIMS
   claims = await extractor.extract({ finalResponse, modelName })
   → SAVE to agent_claims table

2. LOAD EVIDENCE (scoped to promptId)
   evidence = await repository.loadVerificationEvidence(promptId)
   → trace_events for this prompt only

3. VERIFY CLAIMS (verifyClaims)
   FOR each claim (except TASK_COMPLETED):
     → verifyClaim(claim, evidence)
     → Look up rule by claimType
     → Filter evidence via Policy
     → Execute rule → RuleDecision
   
   FOR TASK_COMPLETED:
     → verifyAggregateClaim(childResults)

4. PERSIST VERDICTS
   UPDATE agent_claims SET verdict, reasonCode, explanation, evidence_event_ids

5. COMPUTE RELIABILITY
   calculateReliabilitySummary(verdicts)
   UPDATE execution_sessions
```

**8 Rules (one per claim type):**

| Claim Type | Rule Function | Key Checks |
|------------|---------------|------------|
| FILE_CREATED | `verifyFileCreated` | before=false, after=true, hash exists, SUCCEEDED |
| FILE_MODIFIED | `verifyFileModified` | before=true, after=true, hash CHANGED, SUCCEEDED |
| STRUCTURE_CREATED | `verifyStructureCreated` | All required layers have SUCCEEDED events |
| DEPENDENCY_RULE | `verifyDependencyRule` | violations=0, status=SUCCEEDED |
| COMMAND_SUCCEEDED | `verifyCommandSucceeded` | exitCode=0, SUCCEEDED |
| BUILD_PASSED | `verifyBuildPassed` → `verifyFreshCommandResult` | exitCode=0, SUCCEEDED, no stale file changes |
| TEST_PASSED | `verifyTestPassed` → `verifyFreshCommandResult` | exitCode=0, failed=0, exact counts match, no stale changes |
| TASK_COMPLETED | `verifyAggregateClaim` | ALL children VERIFIED → VERIFIED; ANY CONTRADICTED → CONTRADICTED |

**Verdict Logic:**
- **VERIFIED**: Evidence confirms claim (`REQUIRED_EVIDENCE_CONFIRMED`)
- **CONTRADICTED**: Evidence directly contradicts (`CONTRADICTORY_EVIDENCE_FOUND`)
- **UNSUPPORTED**: Checkable but missing/invalid/stale (`MATCHING_EVIDENCE_NOT_FOUND`, `EVIDENCE_IS_INVALID`, `EVIDENCE_IS_STALE`)
- **UNVERIFIABLE**: No rule exists or basis=behavior/unverifiable (`OBJECTIVE_RULE_NOT_DEFINED`)

**Staleness Check (Build/Test):** If FILE_CREATED/MODIFIED/DELETED occurs AFTER successful build/test → `EVIDENCE_IS_STALE`

---

### 5. Evidence Policy Workflow

**Key Files:**
- `src/modules/verification/domain/claim-verification-policy.ts` - Policy registry
- `src/modules/verification/application/trace-event-mapper.ts` - Capture → Verification event mapping

**Purpose:** Bridge between CLAIMS (what agent said) and EVENTS (what happened).

**Policy Registry (`CLAIM_VERIFICATION_POLICIES`):**

| Claim Type | Strategy | Candidate Event Types | Objective |
|------------|----------|----------------------|-----------|
| FILE_CREATED | EVENT_EVIDENCE | FILE_CREATED, FILE_DELETED | File absent before, exists after |
| FILE_MODIFIED | EVENT_EVIDENCE | FILE_MODIFIED, FILE_DELETED | File existed, hash changed |
| STRUCTURE_CREATED | EVENT_EVIDENCE | DIRECTORY_CREATED, FILE_CREATED, FILE_DELETED | Required dirs/files exist |
| DEPENDENCY_RULE | EVENT_EVIDENCE | ARCHITECTURE_CHECK_COMPLETED | No forbidden dependencies |
| COMMAND_SUCCEEDED | EVENT_EVIDENCE | COMMAND_COMPLETED | Exit code 0 |
| BUILD_PASSED | EVENT_EVIDENCE | BUILD_COMPLETED | Build success after final change |
| TEST_PASSED | EVENT_EVIDENCE | TEST_COMPLETED | Exit code 0, failed=0 |
| TASK_COMPLETED | AGGREGATE_CLAIMS | (none - uses child verdicts) | All children verified |

**TypeScript Guard:** `satisfies Record<ClaimType, ...>` → compile error if new ClaimType lacks policy.

**Event Mapping (`trace-event-mapper.ts`):**
```
OpenCode Event          → Canonical Type              → Outcome Logic
─────────────────────────────────────────────────────────────────────────
PROMPT_SUBMITTED        → PROMPT_SUBMITTED            → RECORDED
MODEL_REQUEST           → MODEL_REQUESTED             → RECORDED
MODEL_RESPONSE          → FINAL_RESPONSE_CAPTURED     → RECORDED
GENERATED_CODE_CAPTURED → fileEventType(before/after) → FILE_CREATED/MODIFIED/DELETED
COMMAND_COMPLETED       → commandEventType(cmd)       → TEST/BUILD/COMMAND_COMPLETED
TEST_PASSED             → TEST_COMPLETED              → SUCCEEDED
BUILD_PASSED            → BUILD_COMPLETED             → SUCCEEDED
ARCHITECTURE_CHECK      → ARCHITECTURE_CHECK_COMPLETED→ FAILED/SUCCEEDED
```

**Metadata Sanitization:**
- Raw content (code, output, responses) → SHA256 hash + length
- Original text DELETED from stored metadata
- Projections extracted for SQL columns (toolName, filePath, exitCode, test counts, etc.)

---

## Repository Structure

```
traceforge/
├── apps/web/                      # Next.js Dashboard
│   ├── src/app/sessions/[promptId]/page.tsx    # Investigation page
│   ├── src/lib/traceforge-api/client.ts        # Server-only API client
│   └── src/features/session-details/claims-table.tsx  # Claims display
│
├── packages/adapter-opencode/       # OpenCode Plugin
│   └── src/operational-plugin.ts    # Hooks → Events → DurableOutbox → API
│
├── packages/verification-contracts/ # Shared Types/Zod Schemas
│
├── src/                             # Backend API
│   ├── server.ts                    # HTTP Server (capture + verification API)
│   ├── prompt-store.ts              # Event ingestion → Prompt lifecycle → Verification trigger
│   └── modules/verification/
│       ├── domain/
│       │   ├── claim-types.ts           # 8 ClaimType values
│       │   ├── verdicts.ts              # 4 Verdicts, 7 ReasonCodes
│       │   ├── claim-verification-policy.ts  # Evidence policies
│       │   └── contracts.ts             # ExtractedClaim, VerificationEvidence, etc.
│       ├── application/
│       │   ├── claim-extractor.ts       # Heuristic extractor
│       │   ├── ollama-claim-extractor.ts # LLM extractor
│       │   ├── claim-verifier.ts        # 8 deterministic rules
│       │   ├── trace-event-mapper.ts    # Capture → Verification events
│       │   └── verification-service.ts  # Pipeline orchestrator
│       └── infrastructure/sqlite/
│           └── sqlite-verification-repository.ts  # SQLite persistence
│
├── test/                            # Tests
├── research/                        # Evaluation pipeline
└── opencode-activity-captures/      # Runtime capture bundles
```

---

## Requirements

- Node.js 22.22.2 or newer
- npm 11 or newer
- OpenCode for live capture
- Ollama with a local extraction model (when model-based extraction enabled)

## Install

```powershell
git clone <repository-url>
cd traceforge
npm install
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env.local
npm run key:generate
```

Put the generated encryption key in `.env`. Set the same `TRACEFORGE_API_TOKEN` in `.env` and `apps/web/.env.local`. Never commit either file.

For local model extraction, install Ollama and configure:

```env
TRACEFORGE_EXTRACTOR=ollama
TRACEFORGE_LLM_ENDPOINT=http://127.0.0.1:11434/api/chat
TRACEFORGE_LLM_MODEL=qwen3.5:4b
TRACEFORGE_LLM_TIMEOUT_MS=180000
```

Enable debug flow logs:
```env
TRACEFORGE_DEBUG_FLOW=1
```

---

## Start TraceForge

Run in separate terminals:

```powershell
# Terminal 1: API Server (port 8080)
npm run api:up

# Terminal 2: Web Dashboard (port 3000)
npm run web:dev
```

Open `http://localhost:3000`. Check API health at `http://127.0.0.1:8080/healthz`.

---

## Blockchain Claim Anchoring (Sepolia and Sui Testnet)

TraceForge can anchor a commitment for a **VERIFIED** claim on either Ethereum Sepolia or Sui Testnet. The dashboards provide separate **Anchor on Sepolia** and **Anchor on Sui** actions beside eligible claims. Each chain stores hashes and audit metadata; prompt text, source files, claim text, and evidence contents remain off-chain.

### What gets anchored

The contract records a session/run hash, claim index, claim/audit manifest hash, evidence-root hash, schema version, chain timestamp, sender address, and a verified attestation. The raw prompt, source code, and evidence content are not sent to either chain. Each chain records its own transaction and event.

### Ethereum Sepolia workflow

1. **Prepare a wallet.** Install/unlock MetaMask, select **Sepolia**, and ensure the account has Sepolia test ETH for gas. Never use mainnet funds for this test workflow.
2. **Run TraceForge.** Start the API and web dashboard as described above, then open a session with at least one `VERIFIED` claim.
3. **Anchor the claim.** In the session details page, click **Anchor on Sepolia** next to the verified claim. Approve the transaction in MetaMask. If MetaMask asks to switch networks, approve switching to Sepolia.
4. **Wait for confirmation.** The claim should show its anchored status and a **View transaction** link. Open the link to inspect the transaction on Sepolia Etherscan.
5. **Check integrity.** Click **Verify on Sepolia**. TraceForge recomputes the expected hashes from its local audit data and compares them with the record returned by the contract.

The current Sepolia deployment is configured in `apps/web/src/features/claim-anchoring/blockchain-anchor-client.ts`:

- Network: Sepolia (chain ID `11155111`)
- Registry: `0x91027C349BDF0aaad3EF3d964f24C94B7c07fDF2`
- Deployment transaction: `0x02924effcdb84ee68ffabd272b430ee4b2b7e526e16bbc484321dd4916bb57f7`

### Sui Testnet workflow

1. **Install a Sui wallet and CLI.** Use a Wallet Standard-compatible wallet such as Slush, set it to **Testnet**, and install the official Sui CLI. The wallet and CLI accounts are separate unless you deliberately import the same account; never share or paste a recovery phrase/private key.
2. **Create/fund a Testnet account.** Create or select a CLI address, set the CLI environment to `testnet`, and request test SUI from [the Sui Testnet faucet](https://faucet.sui.io/?network=testnet). Confirm `sui client active-env` reports `testnet` and `sui client balance` shows funds.
3. **Build and publish the Move package** (first deployment only):

   ```powershell
   cd packages/sui-claim-anchoring/contracts
   sui move build
   sui client publish . --gas-budget 100000000 --json
   ```

   Keep the published **package ID**, shared **Registry object ID**, and **AdminCap object ID** from the output. Publishing is an on-chain Testnet transaction and costs test SUI.

4. **Give the connected wallet the AdminCap.** The wallet used to approve TraceForge anchors must own the `AdminCap` created at publish time. Transfer that object from the publishing CLI address to the Slush/Testnet wallet address, using the IDs from your publish output:

   ```powershell
   sui client transfer --to <SUI_WALLET_PUBLIC_ADDRESS> --object-id <ADMIN_CAP_OBJECT_ID> --gas-budget 10000000
   ```

   Confirm the transfer succeeded and that the AdminCap owner is the wallet you will connect to TraceForge. The address and object IDs are public; the wallet secret is not.

5. **Configure the web app.** Set the deployment IDs in `apps/web/.env.local`:

   ```env
   NEXT_PUBLIC_SUI_ANCHOR_PACKAGE_ID=<PACKAGE_ID>
   NEXT_PUBLIC_SUI_ANCHOR_REGISTRY_ID=<REGISTRY_OBJECT_ID>
   NEXT_PUBLIC_SUI_ANCHOR_ADMIN_CAP_ID=<ADMIN_CAP_OBJECT_ID>
   ```

   Restart the web development server after changing environment variables. These are public on-chain IDs, not secrets.

6. **Anchor the claim.** Open a session containing a `VERIFIED` claim, click **Anchor on Sui**, connect the wallet that owns the AdminCap, and approve the transaction. Confirm the claim shows **Anchored on Sui** and use **View Sui transaction** to inspect the result in Sui Explorer.
7. **Inspect the on-chain event.** A successful call emits `ClaimAnchored`. The shared Registry is used for the claim records; the AdminCap authorizes the publisher wallet to write.

The Move source, build instructions, record schema, and contract behavior are documented in [`packages/sui-claim-anchoring/contracts/README.md`](packages/sui-claim-anchoring/contracts/README.md). The app's Sui wallet setup is in [`apps/web/src/features/sui-claim-anchoring/README.md`](apps/web/src/features/sui-claim-anchoring/README.md).

### Latency measurement notes

The session details page shows a per-claim comparison after an anchor succeeds on one or both chains. It saves successful Sepolia and Sui Testnet timings in the current browser, keyed by prompt, run, and claim. When both are available, it displays the observed difference and transaction links. These end-to-end durations include wallet approval and confirmation time, so they are useful for comparing the user experience of these runs, not as pure network-latency benchmarks. Timing data is browser-local and is not uploaded to the TraceForge API or written to either chain.

---

## Connect an OpenCode Project

1. Build adapter: `npm run build`
2. Add to target project's `opencode.json`:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///E:/absolute/path/traceforge/packages/adapter-opencode/dist/operational-plugin.js"
  ]
}
```
3. Use forward slashes, encode spaces as `%20`
4. If adapter can't find `.env`:
```powershell
$env:TRACEFORGE_RUNTIME_ENV = "E:\absolute\path\traceforge\.env"
opencode
```

---

## Debugging & Observability

**Enable flow logs:** `TRACEFORGE_DEBUG_FLOW=1` in `.env`

**Log files (Windows):**
```
C:\Users\<user>\AppData\Local\Temp\opencode\traceforge-api.out.log
C:\Users\<user>\AppData\Local\Temp\opencode\traceforge-api.err.log
C:\Users\<user>\AppData\Local\Temp\opencode\traceforge-web.out.log
```

**Log Sequence (when query submitted):**
```
[STEP 1] Query received
File: packages/adapter-opencode/src/operational-plugin.ts
Function: TraceForgePlugin chat.message hook
Query: "Create a new file utils/helpers.ts"
PromptId: <sha256-hash>

[STEP 2] Event capture started
File: packages/adapter-opencode/src/operational-plugin.ts
Function: TraceForgePlugin capture
EventType: PROMPT_SUBMITTED

[STEP 2] Event received by Capture API
File: src/server.ts
Endpoint: POST /api/v1/integrations/events

[STEP 3] Saving prompt-scoped verification session
Table: execution_sessions

[STEP 3] Saving event to database
Table: trace_events
EventType: PROMPT_SUBMITTED

... (more events: MODEL_REQUEST, FILE_CREATED, etc.) ...

[STEP 3] Final prompt record saved
Table: prompt_results

[STEP 4] Atomic Claim Extraction started
Function: VerificationApplicationService.verifyPrompt
ExtractorFunction: ClaimExtractor.extract
Model: qwen3:0.6b (or heuristic-v2)

[STEP 5] Claims extracted and saved
Table: agent_claims
Claims: [{ index: 1, type: "FILE_CREATED", target: "utils/helpers.ts", ... }]

[STEP 6] Verification started
Function: verifyClaims
EvidenceCount: 5

[STEP 7] Verification result
ClaimIndex: 1
Status: VERIFIED
ReasonCode: REQUIRED_EVIDENCE_CONFIRMED
Reason: "The file was absent before the operation and exists in the latest relevant state."

[STEP 8] Verification result saved to database
Table: agent_claims
```

---

## Data & Security

- **Database:** `data/traceforge.sqlite`
- **Encryption:** Generated code encrypted with AES-256-GCM
- **Exclusions:** `.env`, `.git`, `node_modules`, large/binary/non-UTF8/out-of-workspace files
- **Hash Chain:** Every trace event stores predecessor hash + own hash (tamper detection)
- **Token:** Never exposed to browser (server-only API client)

---

## Research Evaluation

```powershell
# Format example
npm run research:export -- research/annotation-natural.jsonl

# Evaluate (heuristic baseline)
npm run research:evaluate -- research/evaluation.example.jsonl heuristic

# Evaluate (Ollama - requires Ollama running)
npm run research:evaluate -- research/your-labelled-dataset.jsonl ollama
```

Report includes: extraction precision/recall/F1, verdict accuracy, confusion matrix.

---

## Quality Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Build backend and OpenCode adapter |
| `npm run build:all` | Build backend, adapter, and dashboard |
| `npm run typecheck:all` | Type-check all workspaces |
| `npm test` | Run backend, adapter, and contract tests |
| `npm run web:test` | Run dashboard tests |
| `npm run quality:all` | Complete quality suite |
| `npm run web:test:e2e` | Dashboard HTTP end-to-end tests |

---

## Current Limitations

- Local extraction speed/quality depends on model and hardware
- Semantic claims require independent acceptance oracle
- File-state evidence strongest with recognized file-writing tools
- Test counts depend on supported output formats
- Research dataset is a format example, not publication data

---

## License & Citation

Add chosen open-source license before public release. Add paper citation and archival dataset DOI after acceptance or preprint publication.
