# ADR 0005: Provider-neutral SDK transport and serialized lifecycle

- Status: Accepted
- Date: 2026-08-22

## Context

Custom tools need an ergonomic way to emit provenance without depending on collector internals or provider SDKs. Initialization and completion events must remain correctly ordered even when callers begin recording immediately or invoke methods concurrently.

## Decision

Expose a `TraceTransport` contract for event emission and artifact storage. A run creates task, session, and run identifiers locally, schedules initialization events, and serializes subsequent operations through an internal promise tail. Completion is explicit and terminal.

SDK-supplied facts default to `DECLARED`. The collector remains responsible for validation, redaction, timestamps, sequencing, hashing, idempotency, and persistence. Prompt hashes are added only after redaction.

## Consequences

The SDK works with local collector and future remote transports. Immediate calls cannot race initialization, and completion cannot overtake pending operations. A synthetic SDK workflow validates internal integration but does not meet the acceptance requirement for a real agent adapter or justify `OBSERVED` provider claims.
