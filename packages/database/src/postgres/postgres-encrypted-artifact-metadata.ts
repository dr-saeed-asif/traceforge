import type {
  EncryptedArtifactMetadataRepository,
  EncryptedArtifactRecord,
  EncryptionMetadata
} from "@traceforge/application";
import type { Pool } from "pg";

interface EncryptedBlobRow {
  content_hash: string;
  size_bytes: string;
  backing_content_hash: string;
  backing_storage_reference: string;
  encryption_metadata: EncryptionMetadata;
}

export class PostgresEncryptedArtifactMetadata implements EncryptedArtifactMetadataRepository {
  public constructor(private readonly pool: Pool) {}

  public async find(contentHash: string): Promise<EncryptedArtifactRecord | null> {
    const result = await this.pool.query<EncryptedBlobRow>(
      "SELECT * FROM encrypted_artifact_blobs WHERE content_hash = $1", [contentHash]
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      contentHash: row.content_hash,
      size: Number(row.size_bytes),
      backingContentHash: row.backing_content_hash,
      backingStorageReference: row.backing_storage_reference,
      encryption: row.encryption_metadata
    };
  }

  public async save(record: EncryptedArtifactRecord): Promise<"SAVED" | "EXISTS"> {
    const result = await this.pool.query(
      `INSERT INTO encrypted_artifact_blobs
         (content_hash,size_bytes,backing_content_hash,backing_storage_reference,encryption_metadata)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (content_hash) DO NOTHING`,
      [record.contentHash, record.size, record.backingContentHash,
        record.backingStorageReference, JSON.stringify(record.encryption)]
    );
    return result.rowCount === 1 ? "SAVED" : "EXISTS";
  }
}
