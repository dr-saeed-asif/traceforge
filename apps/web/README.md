# TraceForge Web

This workspace contains the Phase 7 verification frontend. Phase 7.1 provides
the application foundation, Phase 7.2 adds validated shared API contracts plus
a server-only TraceForge client, Phase 7.3 provides the responsive shell and
reusable visual system, Phase 7.4 adds the verification overview dashboard,
and Phases 7.5–7.6 add session browsing and evidence-level investigation.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Keep `TRACEFORGE_API_TOKEN` server-only. Never expose it through a
   `NEXT_PUBLIC_` variable.
3. From the repository root, run `npm run web:dev`.

## API boundary

- Import response types and parsers from `@traceforge/verification-contracts`.
- Import the API client only from server components, server actions, or route
  handlers: `@/lib/traceforge-api`.
- The client sends the bearer token server-side, opts out of fetch caching,
  applies `TRACEFORGE_API_TIMEOUT_MS`, and validates every successful response.
- Never add `NEXT_PUBLIC_TRACEFORGE_API_TOKEN`; that would expose the credential
  to browser JavaScript.

## Interface foundation

Reusable components live under `src/components`. They include the application
shell, page headers and containers, buttons, cards, verdict/status badges,
responsive data tables, and loading/empty/error states. Global tokens in
`src/app/globals.css` define the color, spacing, focus, and verdict language
used by later dashboard screens.

## Overview dashboard

The `/` route is a dynamic server-rendered dashboard backed by the Phase 5
verification overview endpoint. It shows session and claim totals, all four
verdict counts, reliability, coverage, verdict distribution, and the eight
most recent sessions. The optional `from` and `to` URL parameters filter by UTC
calendar date; the selected final day is inclusive.

API configuration errors, timeouts, malformed responses, empty datasets, and
invalid date ranges are presented through the shared application states. The
API bearer token remains inside the server-only client and is never sent to
browser JavaScript.

## Sessions and investigations

The `/sessions` route lists captured prompts with URL-based UTC date filters,
10-date-row pagination, daily claim verdict counts, reliability, and an expandable
query/evidence popup for each selected date
context. Each row links to
`/sessions/[promptId]`.

The investigation route combines session health, extracted claims, verdicts,
reason codes, explanations, and an ordered trace-event timeline. Claim evidence
links jump to highlighted events; linked events navigate back to their claims.
File state, command results, test counts, captured metadata, and complete event
hash-chain values remain available without exposing the server bearer token.

## Quality commands

- `npm run web:format:check`
- `npm run web:typecheck`
- `npm run web:lint`
- `npm run web:test`
- `npm run web:test:e2e`
- `npm run web:build`
- `npm run web:verify:production` runs the complete frontend release gate.

The E2E command starts an isolated mock TraceForge API and a temporary Next.js
development server, then exercises the overview, sessions, filtering, and
investigation routes over HTTP. It does not require a database or persistent
credentials.

## Deployment

Use `.env.production.example` as the production environment template. The
frontend process must be able to reach `TRACEFORGE_API_URL`; the browser does
not need direct API connectivity. `/api/health` is a frontend-process liveness
endpoint and deliberately does not expose configuration or test upstream API
availability.

The complete architecture, deployment, and responsive/accessibility checklist
is documented in `docs/verification/README.md`.
