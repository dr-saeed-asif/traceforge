import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileArtifactStore, FileDurableBuffer } from "../src/index.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "traceforge-test-"));
  directories.push(directory);
  return directory;
}

describe("filesystem adapters", () => {
  it("deduplicates artifact bytes by content hash", async () => {
    const root = await temporaryDirectory();
    const store = new FileArtifactStore(root);
    const content = new TextEncoder().encode("same artifact");
    const first = await store.put(content);
    const second = await store.put(content);

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.storageReference).toBe(first.storageReference);
    expect(Array.from(await store.get(first.contentHash) ?? [])).toEqual(Array.from(content));
  });

  it("writes and removes durable records", async () => {
    const root = await temporaryDirectory();
    const buffer = new FileDurableBuffer<{ safe: string }>(root);
    await buffer.put({ recordId: "record-1", value: { safe: "redacted" } });
    expect(await buffer.list()).toEqual([{ recordId: "record-1", value: { safe: "redacted" } }]);
    expect(await readFile(join(root, "record-1.json"), "utf8")).toContain("redacted");
    await buffer.remove("record-1");
    expect(await buffer.list()).toEqual([]);
  });
});
