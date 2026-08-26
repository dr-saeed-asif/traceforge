# Master prompt conformance audit

This audit maps the master engineering prompt to executable evidence. “Implemented” means code and automated tests exist. It does not mean external infrastructure or a real provider account was provisioned.

## Implemented

- Dynamic normalized event collection, sequencing, durable buffering, idempotency, redaction, canonical hashing, and PostgreSQL persistence.
- Observable-only evidence levels including `NOT_OBSERVED` and `NOT_AVAILABLE`; hidden chain-of-thought is never claimed.
- Individual content-addressed artifacts, deterministic manifests, event-chain and artifact verification diagnostics.
- AES-256-GCM envelope encryption with local and AWS KMS key providers; plaintext data keys are never persisted.
- OpenCode, Ollama, hosted-provider gateways, universal SDK, Git correlation, approvals, optional local anchoring, and an authenticated versioned API.
- Project, agent, test-execution, and normalized metadata tables through additive migrations.
- Run agents, models, resources, artifacts, commands, tests, event timeline, integrity verification, and authorized artifact-content APIs.
- Typed production configuration, structured audit/error logging, research completeness scoring, and operation-overhead measurement.

## Partially implemented

- The dashboard has live run-detail integration and explicit demo/unavailable states, but its hosted deployment needs a real private tunnel and token before production values can be demonstrated.
- OpenCode has official-hook contracts and fixtures; final acceptance still requires retaining a real external OpenCode run in the target environment.
- PostgreSQL integration tests require an administrator-provisioned database and `TEST_DATABASE_URL`.
- Filesystem artifact storage is implemented. S3/MinIO remains a future adapter, as allowed by the prompt.
- Structured logs are ready for collection, but an OpenTelemetry exporter is not bundled because no backend was selected.
- Local root anchoring exists. Public blockchain anchoring remains optional and deliberately absent.

## External acceptance blockers

A real coding-agent run, KMS key, database credentials, workload identity, private Sites tunnel, and authenticated user session cannot be invented by repository code. Cross-provider coverage claims require provider credentials and controlled workloads. Synthetic fixtures validate contracts but are not evidence of real provider execution.
