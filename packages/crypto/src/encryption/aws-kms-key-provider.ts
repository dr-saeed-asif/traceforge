import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DataKey, KeyProvider, WrappedDataKey } from "@traceforge/application";

const CONTEXT = { purpose: "traceforge-artifact-envelope-v1" } as const;

export class AwsKmsKeyProvider implements KeyProvider {
  public constructor(private readonly client: Pick<KMSClient, "send">, private readonly keyId: string) {
    if (keyId.trim() === "") throw new TypeError("AWS KMS keyId is required");
  }
  public async generateDataKey(): Promise<DataKey> {
    const output = await this.client.send(new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: "AES_256", EncryptionContext: CONTEXT }));
    if (!output.Plaintext || output.Plaintext.byteLength !== 32 || !output.CiphertextBlob) throw new Error("AWS KMS returned an incomplete AES-256 data key");
    return { plaintextKey: output.Plaintext.slice(), keyId: output.KeyId ?? this.keyId,
      encryptedDataKey: Buffer.from(output.CiphertextBlob).toString("base64"), keyWrapIv: "", keyWrapAuthTag: "", keyWrapAlgorithm: "AWS-KMS" };
  }
  public async decryptDataKey(wrapped: WrappedDataKey): Promise<Uint8Array> {
    if (wrapped.keyWrapAlgorithm !== "AWS-KMS") throw new TypeError("Wrapped key was not produced by AWS KMS");
    const output = await this.client.send(new DecryptCommand({ KeyId: wrapped.keyId, CiphertextBlob: Buffer.from(wrapped.encryptedDataKey, "base64"), EncryptionContext: CONTEXT }));
    if (!output.Plaintext || output.Plaintext.byteLength !== 32) throw new Error("AWS KMS returned an invalid AES-256 plaintext key");
    return output.Plaintext.slice();
  }
}
