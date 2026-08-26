# ADR 0007: Envelope encryption and hash-only local anchoring

- Status: Accepted
- Date: 2026-08-22

## Context

Generated artifacts may contain proprietary code or secrets. Content hashes need durable proof without disclosing artifact bytes, prompts, responses, or decryption keys.

## Decision

Encrypt each artifact with a random data key using AES-256-GCM and wrap that key through `KeyProvider`. Persist only wrapped key and authenticated-encryption metadata. Verify plaintext identity after every decryption.

Expose `IntegrityAnchor` with root-hash-only input. The development adapter maintains an HMAC-signed, hash-chained local receipt ledger. Its signing key is supplied externally.

## Consequences

Compromise of artifact storage alone does not reveal plaintext. Key-provider compromise still exposes data keys and requires rotation and access auditing. Plaintext hashes can disclose equality and may permit guessing attacks against low-entropy artifacts. Local anchors detect many accidental or unauthorized edits but do not provide independent public proof; production deployments should use a separately controlled signing or anchoring service.
