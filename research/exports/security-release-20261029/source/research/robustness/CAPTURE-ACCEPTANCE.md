# E4 protected capture: proposed design and acceptance contract

Status: **design specified; not implemented or deployed**. The current same-user
outbox does not provide the guarantees below. This document does not upgrade
the security claim of policy 3.1.0.

## Security boundary

Use a durable collector under a dedicated OS principal, plus a protected
OpenCode host/dispatcher under a trusted principal. Run tool commands as a
different, restricted agent principal. The agent must not read or modify the
host/collector binaries, configuration, IPC credentials, memory, logs or store,
debug those processes, inherit their secrets, or acquire elevated privileges.
On Windows these are service accounts, explicit process/file DACLs and a
restricted tool token; on Unix separate UIDs and equivalent process/filesystem
restrictions are required. A socket accepting the same agent UID, an environment
variable, or a MAC key in an agent-readable file is **not** sufficient.

Only the trusted host can connect to an authenticated, ACL-restricted local IPC
endpoint. A protected per-session channel credential binds the approved plugin
instance to that host and session. The agent has no generic "sign this event"
or "submit plugin event" capability. A compromised host/plugin, administrator,
kernel, collector or signing authority is outside this threat model. Unsupported
platforms must advertise *unprotected capture*, not silently claim isolation.

## Protocol and guarantees

The trusted launcher registers a session and capture profile with the collector
**before** any tool runs. An independently protected dispatcher registers every
invocation, including a before/after receipt requirement; this cannot depend on
the plugin hooks whose disabling is under test. Hook-only instrumentation cannot
satisfy the hook-disable acceptance criterion.

Each message binds session ID, plugin instance, invocation ID, authenticated
monotonic sender sequence, event ID and payload digest. The collector checks
origin, sequence, uniqueness and payload authentication, appends to protected
storage, and returns a durable authenticated acknowledgement. Replayed IDs may
only recover the same acknowledgement for identical bytes; conflicting payloads,
cross-session replays, forged senders and sequence rollback are rejected.
An event is *emitted* only after that acknowledgement. The dispatcher does not
release a tool result as captured before the required receipts are acknowledged.

The collector maintains the expected sequence/invocations independently of the
agent. Before scoring, it validates a trusted completion seal containing the
final response digest, last sequence, event count, invocation count and chain
head. Internal gaps, an unacknowledged final suffix, missing receipts, missing
hooks, an absent seal, collector outage or an expired session deadline make
capture INVALID. A sequence check alone cannot detect deletion of the entire
tail, and a plugin cannot independently attest that its own disabled hook ran.

Under these assumptions, the agent cannot delete/reorder acknowledged events
(protected collector store), or inject accepted plugin-originated events
(authenticated protected origin). Availability is not guaranteed: the agent can
cause a run to abort, but it cannot turn that abort into a verified claim.

## Machine-checkable acceptance criteria for the later implementation

| Attack or fault | Required result |
|---|---|
| Forged success, arbitrary agent socket client, forged origin | Ingestion rejects; no verified claim derived from it |
| Internal suppression/reorder; duplicate sequence with changed bytes | Gap/conflict detected; capture INVALID |
| Final suffix removed; final seal suppressed | Trusted expected receipts/seal/deadline detects incomplete capture |
| Plugin hooks disabled before session, or midway | Supervisor registration/invocation ledger detects missing receipts |
| Collector unavailable, crash/restart, interrupted delivery | No unacknowledged event accepted as complete; crash-safe sequence state |
| Replay from another session; retry of identical event | Cross-session replay rejected; identical retry is idempotent |
| Honest run, including collector restart with durable receipts | Decisions agree with unprotected baseline; added latency measured |

Affected claims must become UNSUPPORTED; aggregate reliability must not treat
missing claims as successful. Expose `captureIntegrity=INVALID` and retain the
existing internal reason `EVIDENCE_IS_INVALID`; the report's short reason is
`INVALID`. If a literal new enum value `INVALID` is required instead, that is a
versioned API migration, not a silent change to frozen contracts. The claim gate
must reject INVALID sessions even if the extracted claim list is empty.

Execute the three author attacks at the agent-side transport boundary, not only
by editing verifier input JSON. Add hook-disable, suffix deletion, collector
outage/restart and replay tests. Keep all rejection and failure transcripts;
report per-claim and gate outcomes, per-event acknowledgement p50/p95 latency,
session/family bootstrap intervals and supplementary CP bounds. Provisioning and
verification of the OS boundary remain a prerequisite for claiming E4 passed.
