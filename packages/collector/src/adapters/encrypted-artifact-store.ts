import type {
  ArtifactStore,
  EncryptedArtifactMetadataRepository,
  StoredArtifact
} from "@traceforge/application";
import { EnvelopeEncryption, hashesEqual, sha256 } from "@traceforge/crypto";

export class EncryptedArtifactStore implements ArtifactStore {
  public constructor(
    private readonly backing: ArtifactStore,
    private readonly metadata: EncryptedArtifactMetadataRepository,
    private readonly encryption: EnvelopeEncryption
  ) {}

  public async put(content: Uint8Array): Promise<StoredArtifact> {
    const contentHash = sha256(content);
    const existing = await this.metadata.find(contentHash);
    if (existing !== null) {
      if (!await this.backing.exists(existing.backingContentHash)) {
        throw new Error("Encrypted artifact metadata references a missing backing blob");
      }
      return {
        storageReference: `encrypted:sha256:${contentHash}`,
        contentHash,
        size: existing.size,
        deduplicated: true
      };
    }

    const envelope = await this.encryption.encrypt(content);
    const stored = await this.backing.put(envelope.ciphertext);
    const result = await this.metadata.save({
      contentHash,
      size: content.byteLength,
      backingContentHash: stored.contentHash,
      backingStorageReference: stored.storageReference,
      encryption: envelope.metadata
    });
    return {
      storageReference: `encrypted:sha256:${contentHash}`,
      contentHash,
      size: content.byteLength,
      deduplicated: result === "EXISTS"
    };
  }

  public async get(contentHash: string): Promise<Uint8Array | null> {
    const record = await this.metadata.find(contentHash);
    if (record === null) return null;
    const ciphertext = await this.backing.get(record.backingContentHash);
    if (ciphertext === null) throw new Error("Encrypted artifact backing blob is missing");
    const plaintext = await this.encryption.decrypt(ciphertext, record.encryption);
    const calculatedHash = sha256(plaintext);
    if (plaintext.byteLength !== record.size || !hashesEqual(contentHash, calculatedHash)) {
      plaintext.fill(0);
      throw new Error("Decrypted artifact integrity verification failed");
    }
    return plaintext;
  }

  public async exists(contentHash: string): Promise<boolean> {
    const record = await this.metadata.find(contentHash);
    return record !== null && this.backing.exists(record.backingContentHash);
  }
}
