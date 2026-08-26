# Architecture overview

## Dependency boundaries

TraceForge follows hexagonal architecture. Domain code defines stable business concepts. Application and provenance orchestration operate on those concepts through ports. Infrastructure and provider adapters implement ports and are selected only in application composition roots.

Provider-specific values must be normalized at adapter boundaries. Neither a provider SDK object nor a persistence record may become a domain object by accident.

## Phase 1 packages

- `@traceforge/domain`: immutable contracts for tasks, sessions, agent runs, model invocations, artifacts, and provenance events.
- `@traceforge/crypto`: runtime-independent canonicalization contracts plus the Node SHA-256 implementation. A later split can isolate runtime implementations if browser support requires it.
- `@traceforge/provenance`: event-chain verification, artifact integrity, manifest integrity, and redaction policies.

## Phase 2 packages

- `@traceforge/application`: inward-facing ports for event metadata, durable buffering, artifacts, clocks, and identifiers.
- `@traceforge/collector`: validated ingress, recursive redaction, idempotency, per-run sequencing, bounded backpressure, durable replay, and local adapters.

The collector writes a sanitized record to its durable buffer before attempting metadata persistence. A successful append or confirmed duplicate removes the record. Failures leave it available for replay. Events within one process are serialized per run; the repository port also returns conflicts so a future PostgreSQL adapter can enforce ordering transactionally across collector instances.

## Event semantics

`occurredAt` records the producer-reported time. `recordedAt` records collector time. Ordering is expressed by a run-local sequence. Evidence is classified as `OBSERVED`, `DECLARED`, `INFERRED`, `UNKNOWN`, or `NOT_AVAILABLE`.

No hidden reasoning is reconstructed. Explicit, user-visible summaries may be recorded as summaries, while unavailable internal reasoning remains `NOT_AVAILABLE`.

## Provider adapters

Agent integrations and model gateways depend on `@traceforge/adapter-contracts`, then publish normalized events through the collector bridge. OpenCode observes official plugin hooks. Ollama uses its routed local wrapper. OpenAI, Anthropic, and DeepSeek share lifecycle and bounded capture machinery while retaining isolated protocol profiles. See [hosted provider gateways](hosted-provider-gateways.md).

## Future ports

Implemented ports cover event repositories, artifact stores, durable ingress buffers, transactional outbox publishing, key providers, integrity anchors, clocks, and identifiers. Later phases add authorization and structured telemetry. Ports live at the application boundary rather than in provider adapters.
