# ADR 0002: Canonical SHA-256 event chains

- Status: Accepted
- Date: 2026-08-22

## Context

Equivalent event values must produce identical hashes regardless of object insertion order. A verifier must detect modification, reordering, and missing interior events.

## Decision

Normalize values to JSON-compatible data, serialize with RFC 8785-compatible canonical semantics, omit `eventHash`, prepend `previousEventHash` (or the empty string for the first event), encode as UTF-8, and calculate SHA-256. Sequence numbers begin at one within each run.

Artifact hashes operate directly on bytes. Manifest hashes operate on entries ordered by relative path and artifact ID using deterministic ordinal comparison.

## Consequences

Historical changes and interior deletions are detectable with useful diagnostics. An unanchored chain cannot independently prove that its suffix was not deleted, so signed checkpoints or external anchors remain necessary for stronger deletion resistance.
