export interface StoredArtifact {
  readonly storageReference: string;
  readonly contentHash: string;
  readonly size: number;
  readonly deduplicated: boolean;
}

export interface ArtifactStore {
  put(content: Uint8Array): Promise<StoredArtifact>;
  get(contentHash: string): Promise<Uint8Array | null>;
  exists(contentHash: string): Promise<boolean>;
}
