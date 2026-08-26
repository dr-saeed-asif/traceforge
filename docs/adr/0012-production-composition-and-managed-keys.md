# ADR 0012: Production composition and managed envelope keys

## Status

Accepted

## Decision

The production API uses PostgreSQL as the query store, encrypted artifact metadata, and AWS KMS as the envelope key provider. It has no plaintext artifact-store mode. The hosted dashboard authenticates the workspace user and reaches the API only through a server-side private binding.

## Consequences

Production startup fails fast when required infrastructure settings are absent. KMS availability is required for artifact reads and writes, while event metadata remains queryable through PostgreSQL. The browser cannot access the API bearer token. Deploying the code alone does not create the database, KMS key, service tunnel, workload identity, or secrets; operators must provision and bind them explicitly.
