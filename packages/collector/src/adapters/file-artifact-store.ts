import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactStore, StoredArtifact } from "@traceforge/application";
import { sha256 } from "@traceforge/crypto";

function validateHash(hash: string): void {
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new TypeError("Invalid SHA-256 content hash");
}

export class FileArtifactStore implements ArtifactStore {
  public constructor(private readonly rootDirectory: string) {}

  private pathFor(hash: string): string {
    validateHash(hash);
    return join(this.rootDirectory, hash.slice(0, 2), hash.slice(2));
  }

  public async put(content: Uint8Array): Promise<StoredArtifact> {
    const contentHash = sha256(content);
    const path = this.pathFor(contentHash);
    await mkdir(join(this.rootDirectory, contentHash.slice(0, 2)), { recursive: true });
    let deduplicated = false;
    try { await writeFile(path, content, { flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      deduplicated = true;
    }
    return {
      storageReference: `sha256:${contentHash}`,
      contentHash,
      size: content.byteLength,
      deduplicated
    };
  }

  public async get(contentHash: string): Promise<Uint8Array | null> {
    try { return await readFile(this.pathFor(contentHash)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  public async exists(contentHash: string): Promise<boolean> {
    return (await this.get(contentHash)) !== null;
  }
}
