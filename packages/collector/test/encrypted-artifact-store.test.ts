import type { ArtifactStore, StoredArtifact } from "@traceforge/application";
import { EnvelopeEncryption, LocalKeyProvider, sha256 } from "@traceforge/crypto";
import { describe, expect, it } from "vitest";
import { EncryptedArtifactStore, InMemoryEncryptedArtifactMetadata } from "../src/index.js";

class InspectableStore implements ArtifactStore {
  public readonly values = new Map<string, Uint8Array>();
  public async put(content: Uint8Array): Promise<StoredArtifact> {
    const contentHash = sha256(content);
    const deduplicated = this.values.has(contentHash);
    this.values.set(contentHash, content.slice());
    return { storageReference: `memory:${contentHash}`, contentHash, size: content.byteLength, deduplicated };
  }
  public async get(hash: string) { return this.values.get(hash)?.slice() ?? null; }
  public async exists(hash: string) { return this.values.has(hash); }
}

describe("EncryptedArtifactStore", () => {
  it("stores only ciphertext and deduplicates by plaintext hash", async () => {
    const backing = new InspectableStore();
    const metadata = new InMemoryEncryptedArtifactMetadata();
    const store = new EncryptedArtifactStore(
      backing, metadata, new EnvelopeEncryption(new LocalKeyProvider("local", new Uint8Array(32).fill(4)))
    );
    const plaintext = new TextEncoder().encode("sensitive artifact bytes");
    const first = await store.put(plaintext);
    const second = await store.put(plaintext);

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(backing.values).toHaveLength(1);
    expect([...backing.values.values()].some((value) => Buffer.from(value).includes(Buffer.from(plaintext)))).toBe(false);
    expect(JSON.stringify(await metadata.find(first.contentHash))).not.toContain("sensitive artifact bytes");
    expect(JSON.stringify(await metadata.find(first.contentHash))).not.toContain("plaintextKey");
    expect(Array.from(await store.get(first.contentHash) ?? [])).toEqual(Array.from(plaintext));
  });

  it("rejects a tampered backing blob", async () => {
    const backing = new InspectableStore();
    const metadata = new InMemoryEncryptedArtifactMetadata();
    const store = new EncryptedArtifactStore(
      backing, metadata, new EnvelopeEncryption(new LocalKeyProvider("local", new Uint8Array(32).fill(5)))
    );
    const stored = await store.put(new TextEncoder().encode("original"));
    const record = await metadata.find(stored.contentHash);
    if (record === null) throw new Error("fixture metadata missing");
    const bytes = backing.values.get(record.backingContentHash)!;
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    await expect(store.get(stored.contentHash)).rejects.toThrow();
  });
});
