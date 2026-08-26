import type { DataKey, KeyProvider, WrappedDataKey } from "@traceforge/application";
import { describe, expect, it } from "vitest";
import { EnvelopeEncryption, LocalKeyProvider } from "../src/index.js";

describe("envelope encryption", () => {
  it("round-trips with AES-256-GCM without persisting plaintext keys", async () => {
    const provider = new LocalKeyProvider("local-key-1", new Uint8Array(32).fill(7));
    const encryption = new EnvelopeEncryption(provider);
    const plaintext = new TextEncoder().encode("private generated source");
    const envelope = await encryption.encrypt(plaintext);

    expect(Array.from(envelope.ciphertext)).not.toEqual(Array.from(plaintext));
    expect(JSON.stringify(envelope.metadata)).not.toContain("plaintextKey");
    expect(envelope.metadata).toMatchObject({
      encryptionAlgorithm: "AES-256-GCM", keyWrapAlgorithm: "AES-256-GCM", keyId: "local-key-1"
    });
    expect(Array.from(await encryption.decrypt(envelope.ciphertext, envelope.metadata))).toEqual(Array.from(plaintext));
  });

  it("fails authentication when ciphertext is modified", async () => {
    const encryption = new EnvelopeEncryption(new LocalKeyProvider("key", new Uint8Array(32).fill(2)));
    const envelope = await encryption.encrypt(new TextEncoder().encode("authentic"));
    const changed = envelope.ciphertext.slice();
    changed[0] = (changed[0] ?? 0) ^ 1;
    await expect(encryption.decrypt(changed, envelope.metadata)).rejects.toThrow();
  });

  it("erases the ephemeral plaintext data key after encryption", async () => {
    const ephemeral = new Uint8Array(32).fill(9);
    const provider: KeyProvider = {
      generateDataKey: async (): Promise<DataKey> => ({
        plaintextKey: ephemeral, keyId: "spy", encryptedDataKey: "wrapped",
        keyWrapIv: "iv", keyWrapAuthTag: "tag", keyWrapAlgorithm: "AES-256-GCM"
      }),
      decryptDataKey: async (_wrapped: WrappedDataKey) => { throw new Error("unused"); }
    };
    await new EnvelopeEncryption(provider).encrypt(new Uint8Array([1, 2, 3]));
    expect(Array.from(ephemeral)).toEqual(new Array(32).fill(0));
  });
});
