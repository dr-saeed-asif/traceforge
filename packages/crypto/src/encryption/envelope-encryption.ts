import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EncryptionMetadata, KeyProvider } from "@traceforge/application";
import { sha256 } from "../hashing/sha256.js";

export interface EncryptionEnvelope {
  readonly ciphertext: Uint8Array;
  readonly plaintextHash: string;
  readonly plaintextSize: number;
  readonly metadata: EncryptionMetadata;
}

export class EnvelopeEncryption {
  public constructor(private readonly keys: KeyProvider) {}

  public async encrypt(plaintext: Uint8Array): Promise<EncryptionEnvelope> {
    const plaintextHash = sha256(plaintext);
    const authenticatedContext = `traceforge:artifact:v1:${plaintextHash}`;
    const dataKey = await this.keys.generateDataKey();
    const iv = randomBytes(12);
    try {
      const cipher = createCipheriv("aes-256-gcm", dataKey.plaintextKey, iv);
      cipher.setAAD(Buffer.from(authenticatedContext, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        ciphertext,
        plaintextHash,
        plaintextSize: plaintext.byteLength,
        metadata: {
          keyId: dataKey.keyId,
          encryptedDataKey: dataKey.encryptedDataKey,
          keyWrapIv: dataKey.keyWrapIv,
          keyWrapAuthTag: dataKey.keyWrapAuthTag,
          keyWrapAlgorithm: dataKey.keyWrapAlgorithm,
          encryptionAlgorithm: "AES-256-GCM",
          iv: iv.toString("base64"),
          authTag: cipher.getAuthTag().toString("base64"),
          authenticatedContext
        }
      };
    } finally {
      dataKey.plaintextKey.fill(0);
    }
  }

  public async decrypt(ciphertext: Uint8Array, metadata: EncryptionMetadata): Promise<Uint8Array> {
    const dataKey = await this.keys.decryptDataKey(metadata);
    try {
      const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(metadata.iv, "base64"));
      decipher.setAAD(Buffer.from(metadata.authenticatedContext, "utf8"));
      decipher.setAuthTag(Buffer.from(metadata.authTag, "base64"));
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } finally {
      dataKey.fill(0);
    }
  }
}
