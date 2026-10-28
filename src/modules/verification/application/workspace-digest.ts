import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Consumer-side workspace digest. Must stay identical to `snapshotWorkspace`
 * + `workspaceDigest` in packages/adapter-opencode/src/workspace-observer.ts,
 * so a receiving agent can recompute the subject digest of a claim record
 * from the artifact it was given. Parity is covered by a test.
 */
const EXCLUDED = new Set([
  ".git", "node_modules", ".traceforge", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".vite",
  "dist", "build", "out", "coverage", ".nyc_output", "__pycache__", ".pytest_cache", ".mypy_cache",
  ".ruff_cache", ".tox", ".venv", "venv", "target",
]);
const MAX_HASH_BYTES = 5 * 1024 * 1024;

export async function computeWorkspaceDigest(workspace: string, extraExcludes: readonly string[] = []): Promise<string> {
  const excludes = new Set([...EXCLUDED, ...extraExcludes]);
  const files = new Map<string, string>();
  const pending = [workspace];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excludes.has(entry.name) || entry.name === ".env" || entry.name.startsWith(".env.")) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) {
        const info = await stat(absolute, { bigint: true });
        if (info.size > BigInt(MAX_HASH_BYTES)) throw new Error("Workspace observation is incomplete: file exceeds hash limit");
        const content = await readFile(absolute);
        const after = await stat(absolute, { bigint: true });
        if (info.ino !== after.ino || info.size !== after.size || info.mtimeNs !== after.mtimeNs || info.ctimeNs !== after.ctimeNs)
          throw new Error("Workspace changed while computing its digest");
        files.set(
          relative(workspace, absolute).replace(/\\/gu, "/"),
          createHash("sha256").update(content).digest("hex"),
        );
      }
    }
  }
  const hash = createHash("sha256");
  for (const path of [...files.keys()].sort()) hash.update(`${path}\0${files.get(path)}\n`);
  return hash.digest("hex");
}
