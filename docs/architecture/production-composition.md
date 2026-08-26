# Production composition

The production API process composes the framework-neutral handler with PostgreSQL, filesystem-backed ciphertext, and AWS KMS. It fails at startup when the database URL, API bearer token, artifact directory, or KMS key ID is absent. This makes unencrypted artifact fallback impossible in the production entry point.

Artifact encryption uses a fresh 256-bit data key per envelope. AWS KMS returns plaintext key bytes for immediate AES-256-GCM use and a KMS ciphertext blob for durable metadata. Plaintext data keys are zeroed after use and are never stored. Decryption supplies the same fixed KMS encryption context and verifies the resulting artifact bytes against the recorded SHA-256 hash.

Use the workload platform's AWS credential provider chain instead of static credentials. Restrict the workload principal and KMS key policy to `kms:GenerateDataKey` and `kms:Decrypt` for the configured key. Database credentials, the dashboard bearer token, and AWS credentials do not belong in source control.

The dashboard's server route first requires a Sites workspace identity. It then calls the TraceForge API through `CUSTOMER_HTTP_TRACEFORGE_API`, a private service binding, and injects the API token only on the server. The browser never receives that credential. All four upstream requests must succeed before live data is shown; otherwise the interface reports that the API is unavailable. Demo data is used only when no live run was requested and is always labeled.

Required API variables are listed in `apps/api/.env.example`. The hosted runtime additionally needs `TRACEFORGE_API_TOKEN` and the private binding. Infrastructure provisioning remains environment-specific and is deliberately outside the application repository.
