import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { DataKey, KeyProvider, WrappedDataKey } from "@traceforge/application";

const KEY_BYTES = 32;
const IV_BYTES = 12;

export class LocalKeyProvider implements KeyProvider {
  private readonly keyEncryptionKey: Uint8Array;

  public constructor(private readonly keyId: string, keyEncryptionKey: Uint8Array) {
    if (keyId.trim() === "") throw new TypeError("keyId is required");
    if (keyEncryptionKey.byteLength !== KEY_BYTES) throw new TypeError("Local key-encryption key must be 32 bytes");
    this.keyEncryptionKey = keyEncryptionKey.slice();
  }

  public async generateDataKey(): Promise<DataKey> {
    const plaintextKey = randomBytes(KEY_BYTES);
    const keyWrapIv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.keyEncryptionKey, keyWrapIv);
    cipher.setAAD(Buffer.from(this.keyId, "utf8"));
    const encrypted = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    return {
      plaintextKey,
      keyId: this.keyId,
      encryptedDataKey: encrypted.toString("base64"),
      keyWrapIv: keyWrapIv.toString("base64"),
      keyWrapAuthTag: cipher.getAuthTag().toString("base64"),
      keyWrapAlgorithm: "AES-256-GCM"
    };
  }

  public async decryptDataKey(wrapped: WrappedDataKey): Promise<Uint8Array> {
    if (wrapped.keyId !== this.keyId) throw new Error(`Unknown local key ID: ${wrapped.keyId}`);
    const decipher = createDecipheriv("aes-256-gcm", this.keyEncryptionKey, Buffer.from(wrapped.keyWrapIv, "base64"));
    decipher.setAAD(Buffer.from(wrapped.keyId, "utf8"));
    decipher.setAuthTag(Buffer.from(wrapped.keyWrapAuthTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(wrapped.encryptedDataKey, "base64")),
      decipher.final()
    ]);
  }
}
