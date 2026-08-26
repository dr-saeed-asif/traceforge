# ADR 0003: Durable sanitized ingress and run-local ordering

- Status: Accepted
- Date: 2026-08-22

## Context

Collector or metadata-storage outages must not silently lose accepted activity. At the same time, raw secrets must never enter a retry queue. Concurrent events must form a deterministic chain within each run, and provider retries must remain idempotent.

## Decision

The collector validates and recursively redacts an ingress event before placing it in a durable buffer. Processing is serialized per run through a bounded queue. The repository performs an atomic append contract using the expected sequence and preceding hash and can report conflicts. A successful append or confirmed duplicate removes the buffered record; failures retain it for replay.

Idempotency keys prefer an explicit producer key, then an adapter-scoped provider event ID, then a SHA-256 fingerprint of the sanitized canonical event. The final database adapter must enforce idempotency and sequence constraints transactionally.

## Consequences

Recoverable storage failures do not discard sanitized events, duplicate provider delivery does not create duplicate provenance, and local queue growth is bounded. Redaction necessarily occurs before event hashing, so integrity protects the stored redacted representation rather than undisclosed plaintext. A file-backed spool is suitable for local operation; production deployments need protected filesystem permissions, capacity monitoring, and operational handling for corrupted records.
