import { canonicalize, hashesEqual, sha256, type CanonicalJsonValue } from "@traceforge/crypto";

export interface ArtifactIntegrityRecord {
  readonly algorithm: "sha256";
  readonly hash: string;
  readonly size: number;
  readonly timestamp: string;
}

export interface ArtifactVerificationResult {
  readonly valid: boolean;
  readonly expectedHash: string;
  readonly calculatedHash: string;
  readonly expectedSize: number;
  readonly calculatedSize: number;
}

export interface ManifestEntry {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly hash: string;
  readonly size: number;
}

export function createArtifactIntegrity(
  content: Uint8Array,
  timestamp = new Date().toISOString()
): ArtifactIntegrityRecord {
  return { algorithm: "sha256", hash: sha256(content), size: content.byteLength, timestamp };
}

export function verifyArtifact(
  content: Uint8Array,
  integrity: ArtifactIntegrityRecord
): ArtifactVerificationResult {
  const calculatedHash = sha256(content);
  return {
    valid: integrity.size === content.byteLength && hashesEqual(integrity.hash, calculatedHash),
    expectedHash: integrity.hash,
    calculatedHash,
    expectedSize: integrity.size,
    calculatedSize: content.byteLength
  };
}

export function calculateManifestHash(entries: readonly ManifestEntry[]): string {
  const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
  const ordered = [...entries].sort((left, right) =>
    compare(left.relativePath, right.relativePath) || compare(left.artifactId, right.artifactId)
  );
  return sha256(canonicalize(ordered as unknown as CanonicalJsonValue));
}
