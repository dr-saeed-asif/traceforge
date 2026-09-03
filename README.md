# TraceForge

TraceForge ab ek minimal OpenCode prompt capture service hai.

Ye do jagah output save karta hai:

- MySQL table: `traceforge.prompt_results`
- Folder output: `opencode-activity-captures/`

## Stored Fields

Har completed prompt ke liye ye 5 fields save hoti hain:

- `PromptQuery`
- `AgentName`
- `ModelName`
- `Result`
- `Resources`

## Project Structure

| Path | Purpose |
| --- | --- |
| `src/server.ts` | Minimal HTTP API |
| `src/prompt-store.ts` | Prompt aggregation + MySQL insert + capture files |
| `src/migrate.ts` | MySQL migration runner |
| `packages/adapter-opencode/` | OpenCode plugin |
| `infrastructure/mysql-migrations/` | MySQL schema |
| `opencode-activity-captures/` | Prompt-wise JSON capture output |

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
```

## Install

```powershell
npm install
npm run build
```

## Create Table

```powershell
npm run db:migrate
```

This creates:

```sql
prompt_results(
  PromptQuery,
  AgentName,
  ModelName,
  Result,
  Resources
)
```

## Start API

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

## OpenCode Setup

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
SELECT PromptQuery, AgentName, ModelName, Result, Resources
FROM traceforge.prompt_results;
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
