import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHashCache,
  diffWorkspace,
  parseTestCounts,
  snapshotWorkspace,
  workspaceDigest,
} from "../src/workspace-observer.js";

/** Review fixes T1 (shell side effects) and T3 (runner-specific counts). */
describe("workspace observer", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("detects edits, creations, deletions and directories made outside tool hooks", async () => {
    dir = await mkdtemp(join(tmpdir(), "tf-ws-"));
    await writeFile(join(dir, "app.ts"), "a");
    await writeFile(join(dir, "old.ts"), "x");
    await mkdir(join(dir, "node_modules"));
    await writeFile(join(dir, "node_modules", "dep.js"), "1");
    const before = await snapshotWorkspace(dir);
    // Simulates `sed -i`, `echo >`, `rm`, `mkdir` run through a shell tool.
    await writeFile(join(dir, "app.ts"), "b");
    await writeFile(join(dir, "new.ts"), "n");
    await rm(join(dir, "old.ts"));
    await mkdir(join(dir, "lib"));
    await writeFile(join(dir, "node_modules", "dep.js"), "2");
    const after = await snapshotWorkspace(dir);
    const changes = diffWorkspace(before, after).map((c) => `${c.kind}:${c.path}`);
    expect(changes).toEqual([
      "FILE_MODIFIED:app.ts",
      "DIRECTORY_CREATED:lib",
      "FILE_CREATED:new.ts",
      "FILE_DELETED:old.ts",
    ]);
    expect(after.complete).toBe(true);
    expect(workspaceDigest(before)).not.toBe(workspaceDigest(after));
  });

  it("marks the manifest incomplete when the file limit is reached", async () => {
    dir = await mkdtemp(join(tmpdir(), "tf-ws-"));
    for (const name of ["a", "b", "c"]) await writeFile(join(dir, name), name);
    expect((await snapshotWorkspace(dir, { maxFiles: 2 })).complete).toBe(false);
  });
});

describe("test-count parsing", () => {
  it("reads Vitest test counts, not test-file counts", () => {
    const out = " ✓ a.test.ts (5 tests)\n\n Test Files  2 passed (2)\n      Tests  12 passed (12)\n";
    expect(parseTestCounts(out)).toEqual({ passed: 12, failed: 0 });
  });
  it("reads Jest test counts, not suite counts", () => {
    const out = "Test Suites: 1 failed, 3 passed, 4 total\nTests:       2 failed, 40 passed, 42 total\n";
    expect(parseTestCounts(out)).toEqual({ passed: 40, failed: 2 });
  });
  it("reads node:test TAP and spec reporters", () => {
    expect(parseTestCounts("# tests 6\n# pass 6\n# fail 0\n")).toEqual({ passed: 6, failed: 0 });
    expect(parseTestCounts("ℹ tests 3\nℹ pass 2\nℹ fail 1\n")).toEqual({ passed: 2, failed: 1 });
  });
  it("reads pytest summaries", () => {
    expect(parseTestCounts("===== 3 failed, 17 passed, 1 skipped in 0.52s =====")).toEqual({
      passed: 17,
      failed: 3,
      skipped: 1,
    });
  });
});

/** Review item 27: the hash cache must never hide a change. */
describe("workspace observer hash cache", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("detects same-size rewrites inside the racy window", async () => {
    dir = await mkdtemp(join(tmpdir(), "tf-cache-"));
    await writeFile(join(dir, "a.ts"), "aaaa");
    const cache = createHashCache();
    const before = await snapshotWorkspace(dir, { cache });
    await writeFile(join(dir, "a.ts"), "bbbb"); // same size, same second
    const after = await snapshotWorkspace(dir, { cache });
    expect(diffWorkspace(before, after).map((c) => [c.path, c.kind])).toEqual([["a.ts", "FILE_MODIFIED"]]);
  });

  it("produces the same manifest with and without a warm cache", async () => {
    dir = await mkdtemp(join(tmpdir(), "tf-cache-"));
    for (let i = 0; i < 20; i += 1) await writeFile(join(dir, `f${i}.ts`), `v${i}`);
    const old = new Date(Date.now() - 10_000);
    const { utimes } = await import("node:fs/promises");
    for (let i = 0; i < 20; i += 1) await utimes(join(dir, `f${i}.ts`), old, old);
    const cache = createHashCache();
    await snapshotWorkspace(dir, { cache });
    const warm = await snapshotWorkspace(dir, { cache });
    const cold = await snapshotWorkspace(dir);
    expect(workspaceDigest(warm)).toBe(workspaceDigest(cold));
    await writeFile(join(dir, "f3.ts"), "changed");
    const afterEdit = await snapshotWorkspace(dir, { cache });
    expect(diffWorkspace(warm, afterEdit).map((c) => [c.path, c.kind])).toEqual([["f3.ts", "FILE_MODIFIED"]]);
  });
});


describe("incomplete observation safety", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  it("does not treat an oversized file as a content hash", async () => {
    dir = await mkdtemp(join(tmpdir(), "tf-limit-"));
    await writeFile(join(dir, "big.ts"), "12345");
    const manifest = await snapshotWorkspace(dir, { maxHashBytes: 4 });
    expect(manifest.complete).toBe(false);
    expect(manifest.files.has("big.ts")).toBe(false);
  });
  it("does not invent creates or deletes from a truncated manifest", () => {
    const full = { complete: true, files: new Map([["a", "hash"]]), directories: new Set<string>() };
    const partial = { complete: false, files: new Map<string, string>(), directories: new Set<string>() };
    expect(diffWorkspace(full, partial)).toEqual([]);
    expect(diffWorkspace(partial, full)).toEqual([]);
  });
});
