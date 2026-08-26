# ADR 0006: Git byte correlation and explicit approval

- Status: Accepted
- Date: 2026-08-22

## Context

Path similarity or temporal proximity is insufficient to claim that an artifact entered a commit. Likewise, writing AI output to disk or committing it cannot be interpreted as human approval.

## Decision

Inspect Git commits using immutable commit IDs and raw blob bytes. Correlate artifacts by exact relative path and SHA-256 content hash, retaining matched and unmatched artifact IDs and an evidence grade. Hash binary-capable diffs for changed-file integrity.

Represent approval as an explicit human event targeting exactly one artifact or manifest. Keep commit association and approval independent: either can exist without the other.

## Consequences

TraceForge can answer which captured artifact bytes appear in a commit without overstating partial matches. Repositories using filters, clean/smudge transformations, submodules, large-file indirection, or unusual path encodings may need specialized future adapters. Approval identity still requires authentication at the eventual API boundary; an SDK-supplied reviewer is `DECLARED`, not independently authenticated.
