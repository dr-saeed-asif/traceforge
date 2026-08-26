# Initial threat model

## Assets

Provenance events, generated artifacts, prompts, tool and command records, approvals, Git associations, encryption keys, producer credentials, and integrity roots.

## Trust boundaries

Agent/provider to adapter, adapter to collector, collector to storage, API to clients, and TraceForge to external key or anchor providers. Repository content and all provider/tool output are untrusted input.

## Threats and planned controls

| Threat | Controls |
|---|---|
| Historical event mutation or reordering | Canonical event hash chain and append-only storage permissions |
| Artifact modification | Raw-byte artifact hashes and deterministic manifests |
| Chain-tail deletion | Signed local checkpoints; independently controlled external anchors in a later phase |
| Fake activity or replay | Authenticated producers, scoped credentials, provider IDs, and idempotency keys |
| Secret-bearing prompts and commands | Configurable redaction before persistence, logging, hashing, and publication |
| Unauthorized artifact access | Authorization, audited reads, and AES-256-GCM envelope encryption |
| Key disclosure | Externally supplied key-encryption keys; ephemeral data-key erasure; never persist plaintext keys |
| Malicious repository or tool content | Strict validation, output encoding, no execution of captured data |
| Misrepresented inferred evidence | Mandatory evidence classification and UI distinction |
| Collector or storage outage | Bounded queues and a durable local spool in Phase 2 |

## Residual risk

Hashes demonstrate consistency, not truth. A compromised authenticated producer can submit false observations. Pattern-based redaction cannot recognize every possible secret and may also redact benign high-entropy content. Independent producer attestations, least privilege, capture policies, and external anchoring reduce but do not eliminate these risks.

Local anchoring is not an independent timestamp authority. An attacker controlling both its receipt ledger and HMAC key can rewrite history. Plaintext artifact hashes also reveal equality and may enable guessing attacks for predictable content even when bytes are encrypted.
