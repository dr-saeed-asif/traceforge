import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { describe,expect,it,vi } from "vitest";
import { AwsKmsKeyProvider,EnvelopeEncryption } from "../src/index.js";

describe("AwsKmsKeyProvider",()=>{
  it("uses AES-256 data keys and a fixed encryption context without retaining plaintext",async()=>{
    const plaintext=new Uint8Array(32).fill(7),ciphertext=new Uint8Array([1,2,3,4]);
    const send=vi.fn(async(command:unknown)=>{if(command instanceof GenerateDataKeyCommand){expect(command.input).toMatchObject({KeyId:"alias/traceforge",KeySpec:"AES_256",EncryptionContext:{purpose:"traceforge-artifact-envelope-v1"}});return{Plaintext:plaintext,CiphertextBlob:ciphertext,KeyId:"arn:aws:kms:test:key/1"}}if(command instanceof DecryptCommand){expect(command.input).toMatchObject({KeyId:"arn:aws:kms:test:key/1",EncryptionContext:{purpose:"traceforge-artifact-envelope-v1"}});return{Plaintext:plaintext}}throw new Error("unexpected command")});
    const provider=new AwsKmsKeyProvider({send} as never,"alias/traceforge"),encryption=new EnvelopeEncryption(provider);
    const envelope=await encryption.encrypt(new TextEncoder().encode("protected artifact"));
    expect(envelope.metadata).toMatchObject({keyId:"arn:aws:kms:test:key/1",keyWrapAlgorithm:"AWS-KMS",encryptedDataKey:Buffer.from(ciphertext).toString("base64")});
    expect(new TextDecoder().decode(await encryption.decrypt(envelope.ciphertext,envelope.metadata))).toBe("protected artifact");expect(send).toHaveBeenCalledTimes(2);
  });
  it("rejects non-KMS wrapped keys before calling AWS",async()=>{const send=vi.fn();const provider=new AwsKmsKeyProvider({send} as never,"key");await expect(provider.decryptDataKey({keyId:"local",encryptedDataKey:"x",keyWrapIv:"x",keyWrapAuthTag:"x",keyWrapAlgorithm:"AES-256-GCM"})).rejects.toThrow("not produced by AWS KMS");expect(send).not.toHaveBeenCalled()});
});
