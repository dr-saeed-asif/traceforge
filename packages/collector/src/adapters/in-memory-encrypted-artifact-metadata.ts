import type {
  EncryptedArtifactMetadataRepository,
  EncryptedArtifactRecord
} from "@traceforge/application";

export class InMemoryEncryptedArtifactMetadata implements EncryptedArtifactMetadataRepository {
  private readonly records = new Map<string, EncryptedArtifactRecord>();

  public async find(contentHash: string): Promise<EncryptedArtifactRecord | null> {
    const record = this.records.get(contentHash);
    return record === undefined ? null : structuredClone(record);
  }

  public async save(record: EncryptedArtifactRecord): Promise<"SAVED" | "EXISTS"> {
    if (this.records.has(record.contentHash)) return "EXISTS";
    this.records.set(record.contentHash, structuredClone(record));
    return "SAVED";
  }
}
