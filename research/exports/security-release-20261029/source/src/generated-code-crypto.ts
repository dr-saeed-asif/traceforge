import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedGeneratedCode {
  readonly version: 1;
  readonly algorithm: "aes-256-gcm";
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

export function parseGeneratedCodeKey(value: string | undefined): Buffer {
  if (!value?.trim()) throw new Error("TRACEFORGE_GENERATED_CODE_PRIVATE_KEY is required");
  const key = Buffer.from(value.trim(), "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== value.trim()) {
    throw new Error("TRACEFORGE_GENERATED_CODE_PRIVATE_KEY must be a Base64-encoded 32-byte key");
  }
  return key;
}

export function encryptGeneratedCode(value: unknown, key: Buffer): EncryptedGeneratedCode {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

export function decryptGeneratedCode<T>(value: EncryptedGeneratedCode, key: Buffer): T {
  if (value.version !== 1 || value.algorithm !== "aes-256-gcm") throw new Error("Unsupported generated-code encryption format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
