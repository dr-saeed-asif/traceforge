# Sui Move contract

`traceforge_claim_anchoring::verified_claim_registry` stores one immutable
commitment for each `(sessionHash, claimIndex)` pair.

## On-chain record

| Move field | TraceForge value | Representation |
| --- | --- | --- |
| `session_hash` | Session and run identity digest | 32 bytes (SHA-256) |
| `claim_index` | Claim index within the session | `u32` |
| `manifest_hash` | Canonical claim/audit manifest digest | 32 bytes (SHA-256) |
| `evidence_root` | Evidence event commitment | 32 bytes (SHA-256) |
| `schema_version` | Anchor schema version | `u32` |
| `anchored_at_ms` | Sui consensus timestamp | `u64`, milliseconds |
| `anchored_by` | Transaction sender | Sui address |
| `verified` | Verified-claim attestation | `bool`, set by the contract |

Prompt text, source files, claim text, and evidence contents are not contract
arguments. The shared `Registry` stores records as dynamic fields, and each
successful anchor emits a `ClaimAnchored` event. An `AdminCap` is issued to the
publisher and required for writes; the wallet holding it is the trusted
attestor for this initial testnet flow.

## Build and test

From this directory, run `sui move build` and `sui move test`. Publish only to
Sui testnet during the initial integration. The publish transaction creates a
shared `Registry` and transfers its `AdminCap` to the publisher.

The shared registry serializes writes to this proof-of-concept registry. That
can affect measured app-level latency under concurrent writes; latency results
must report the tested registry and network conditions.
