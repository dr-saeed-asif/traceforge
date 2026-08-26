# PostgreSQL model

The Phase 3 schema separates task/session/run metadata, model invocations and prompts, the immutable event log, query projections, artifacts and manifests, approvals, Git associations, integrity records, anchors, ingress receipts, and the transactional outbox.

## Transactional append

For each append, the repository:

1. begins a transaction;
2. acquires a transaction-scoped advisory lock derived from `runId`;
3. checks the adapter-scoped idempotency receipt;
4. reads and validates the current run head;
5. inserts the event;
6. inserts its idempotency receipt;
7. inserts an outbox message;
8. commits all three records atomically.

The collector retries a sequence conflict with a fresh run head. Database constraints independently enforce unique run sequences, event hashes, and idempotency keys.

## Artifact identity

Artifact metadata is not unique by content hash because two runs or paths can legitimately reference the same bytes. The content-address index accelerates deduplication lookup while the artifact store deduplicates the underlying blob.

## Permissions

Schema migration runs as an owner. Runtime and read-only access use separate `NOLOGIN` group roles. The runtime role receives narrowly scoped updates for lifecycle projections and outbox leases but no event-log update, delete, or truncate privilege.
