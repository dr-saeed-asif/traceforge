import type { WrappedDataKey } from "./key-provider.js";

export interface EncryptionMetadata extends WrappedDataKey {
  readonly encryptionAlgorithm: "AES-256-GCM";
  readonly iv: string;
  readonly authTag: string;
  readonly authenticatedContext: string;
}

export interface EncryptedArtifactRecord {
  readonly contentHash: string;
  readonly size: number;
  readonly backingContentHash: string;
  readonly backingStorageReference: string;
  readonly encryption: EncryptionMetadata;
}

export interface EncryptedArtifactMetadataRepository {
  find(contentHash: string): Promise<EncryptedArtifactRecord | null>;
  save(record: EncryptedArtifactRecord): Promise<"SAVED" | "EXISTS">;
}
