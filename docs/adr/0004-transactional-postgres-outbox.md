# ADR 0004: Transactional PostgreSQL append and outbox

- Status: Accepted
- Date: 2026-08-22

## Context

Multiple collectors can process the same run, provider events can be retried, and downstream publication can fail after metadata persistence. Process-local sequencing cannot provide cross-instance correctness.

## Decision

Use a PostgreSQL transaction-scoped advisory lock keyed by run ID. Within that transaction, verify the current head, append the event, record its idempotency key, and create an outbox message. Unique constraints remain the final protection against duplicates and sequence collisions.

Workers claim outbox records using `FOR UPDATE SKIP LOCKED`, a bounded batch, and an expiring lease. Publishing is at least once; downstream consumers must also be idempotent.

Migration files are ordered and checksum recorded. Privileged role creation and grants remain separate from ordinary application migrations because managed PostgreSQL services differ in role-management authority.

## Consequences

Ordering is consistent across collector instances and no committed event lacks its publication intent. Hot runs serialize at the database boundary by design. Advisory locking is PostgreSQL-specific infrastructure and does not enter domain or application contracts. Outbox records require monitoring, retry limits, and later dead-letter handling.
