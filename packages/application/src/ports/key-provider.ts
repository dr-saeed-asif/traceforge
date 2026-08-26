export interface WrappedDataKey {
  readonly keyId: string;
  readonly encryptedDataKey: string;
  readonly keyWrapIv: string;
  readonly keyWrapAuthTag: string;
  readonly keyWrapAlgorithm: "AES-256-GCM" | "AWS-KMS";
}

export interface DataKey extends WrappedDataKey {
  /** Ephemeral key bytes. Callers must erase this array after use. */
  readonly plaintextKey: Uint8Array;
}

export interface KeyProvider {
  generateDataKey(): Promise<DataKey>;
  decryptDataKey(wrapped: WrappedDataKey): Promise<Uint8Array>;
}
