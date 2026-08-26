# Git provenance and approval

## Git observation

`GitCliAdapter` invokes the Git executable directly without a command shell. It resolves an immutable commit ID, reads commit metadata, parses NUL-delimited changed paths, retrieves before and after blob bytes, and hashes the exact binary diff. Revision input beginning with `-` is rejected, and file paths are passed after `--` where Git supports it.

For every changed file TraceForge records:

- operation and current path;
- previous path for renames;
- SHA-256 of the parent blob when present;
- SHA-256 of the committed blob when present;
- SHA-256 of Git's binary-capable per-file diff representation.

## Correlation evidence

An artifact is matched only when both its relative path and content hash equal the committed file. A non-empty set in which every artifact matches is `CONFIRMED`. A mixture of matches and misses is `CANDIDATE`. No matches—or no supplied artifacts—is `UNRESOLVED`.

This proves byte correspondence between captured artifacts and a commit. It does not prove that every byte in the commit was AI generated, nor that the commit was reviewed.

## Approval

Approval is an explicit SDK operation targeting exactly one artifact or manifest. `APPROVED` emits `HUMAN_APPROVAL`; `REJECTED` and `REQUESTED_CHANGES` emit `HUMAN_REJECTION` with the exact decision retained in the payload. Writing an artifact or creating a commit never creates approval automatically.

PostgreSQL projection repositories support run approval lists and commit-to-run provenance queries. The immutable event remains the audit fact; projection rows exist for efficient business queries.
