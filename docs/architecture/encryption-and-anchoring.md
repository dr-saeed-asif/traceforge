# Encryption and anchoring

## Envelope encryption

Each artifact receives a random 256-bit data-encryption key. Artifact bytes are encrypted using AES-256-GCM with a unique 96-bit IV. Authenticated context binds the ciphertext to the plaintext SHA-256 identity. The data key is independently wrapped using AES-256-GCM through `KeyProvider`.

Persisted metadata contains only:

- encryption and key-wrap algorithms;
- key-provider key ID;
- wrapped data key;
- data and key-wrap IVs and authentication tags;
- non-secret authenticated context;
- plaintext and ciphertext content hashes, size, and backing storage reference.

The ephemeral plaintext data-key array is erased after encryption or decryption. JavaScript runtimes may retain internal copies beyond application control, so this is defense in depth rather than a formal memory-erasure guarantee.

`LocalKeyProvider` copies its supplied key-encryption key and is intended for development. The caller must load that key from protected configuration and must never place it in PostgreSQL, artifact storage, logs, or source control. AWS KMS, Vault, Azure Key Vault, and GCP KMS can implement the same application port.

## Encrypted artifact storage

`EncryptedArtifactStore` decorates any artifact store. It hashes plaintext for logical identity, stores only GCM ciphertext in the backing store, and stores envelope metadata separately. Retrieval authenticates ciphertext, decrypts it, then verifies plaintext size and SHA-256 before returning bytes.

Deduplication occurs by plaintext hash in metadata. The backing ciphertext remains content-addressed independently. Concurrent first writes can create an unreachable encrypted blob; later maintenance may garbage-collect blobs not referenced by metadata.

## Local anchoring

`LocalAnchorAdapter` writes JSON Lines receipts containing a root hash, timestamp, sequence, preceding receipt hash, receipt hash, adapter ID, and HMAC-SHA-256 signature. It never receives prompts, artifacts, source code, or model responses.

Before appending, it verifies the complete existing receipt chain. The signing key is externally supplied and not written beside the ledger. This adapter improves local tamper detection but is not an independent timestamp authority and does not protect against an attacker who controls both ledger and signing key. External anchors can implement `IntegrityAnchor` later.
