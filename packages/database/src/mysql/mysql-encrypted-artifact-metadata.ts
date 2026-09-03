import type { EncryptedArtifactMetadataRepository, EncryptedArtifactRecord, EncryptionMetadata } from "@traceforge/application";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";

interface EncryptedBlobRow extends RowDataPacket {
  content_hash: string; size_bytes: number | string; backing_content_hash: string;
  backing_storage_reference: string; encryption_metadata: EncryptionMetadata | string;
}

export class MySqlEncryptedArtifactMetadata implements EncryptedArtifactMetadataRepository {
  public constructor(private readonly pool: Pool) {}
  public async find(contentHash: string): Promise<EncryptedArtifactRecord | null> {
    const [rows] = await this.pool.query<EncryptedBlobRow[]>("SELECT * FROM encrypted_artifact_blobs WHERE content_hash = ?", [contentHash]);
    const row = rows[0];
    return row === undefined ? null : {
      contentHash: row.content_hash, size: Number(row.size_bytes), backingContentHash: row.backing_content_hash,
      backingStorageReference: row.backing_storage_reference, encryption: typeof row.encryption_metadata === "string" ? JSON.parse(row.encryption_metadata) as EncryptionMetadata : row.encryption_metadata
    };
  }
  public async save(record: EncryptedArtifactRecord): Promise<"SAVED" | "EXISTS"> {
    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO encrypted_artifact_blobs
        (content_hash,size_bytes,backing_content_hash,backing_storage_reference,encryption_metadata)
       VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE content_hash = content_hash`,
      [record.contentHash, record.size, record.backingContentHash, record.backingStorageReference, JSON.stringify(record.encryption)]
    );
    return result.affectedRows === 1 ? "SAVED" : "EXISTS";
  }
}
