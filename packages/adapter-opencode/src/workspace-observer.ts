import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Workspace-level observation for shell-like tools (review fix T1).
 *
 * Write/edit tools name their targets, so the plugin snapshots those files
 * directly. Shell commands (`sed -i`, redirects, `rm`, generators) do not, so
 * before and after every shell invocation the plugin records a manifest of the
 * workspace and diffs the two. Changes found this way become ordinary
 * file-state evidence and also mark the command's own completion event, so a
 * test or build that is followed (or accompanied) by a shell edit cannot be
 * accepted as fresh.
 */
export interface WorkspaceManifest {
  readonly files: ReadonlyMap<string, string>;
  readonly directories: ReadonlySet<string>;
  /** False when limits were hit; freshness must then not be asserted. */
  readonly complete: boolean;
}

export interface WorkspaceChange {
  readonly path: string;
  readonly kind: "FILE_CREATED" | "FILE_MODIFIED" | "FILE_DELETED" | "DIRECTORY_CREATED";
  readonly hashBefore: string | null;
  readonly hashAfter: string | null;
}

export interface WorkspaceObserverOptions {
  readonly maxFiles?: number;
  readonly maxHashBytes?: number;
  readonly extraExcludes?: readonly string[];
  /** Reuse hashes of files whose stat signature is unchanged (see HashCache). */
  readonly cache?: HashCache;
}

/**
 * Hash cache keyed by path (review item 27: snapshot overhead). An entry is
 * reused only when inode, size, mtime and ctime (nanoseconds) are all equal
 * and the file was not modified within RACY_WINDOW_NS of when it was hashed;
 * such "racily clean" files are re-hashed, as git does for its index.
 */
export type HashCache = Map<string, { readonly signature: string; readonly hash: string; readonly hashedAtNs: bigint }>;
const RACY_WINDOW_NS = 2_000_000_000n;

export function createHashCache(): HashCache {
  return new Map();
}

/** Directories never treated as source state: VCS, dependencies, caches, build outputs. */
export const DEFAULT_EXCLUDED_DIRECTORIES: readonly string[] = [
  ".git",
  "node_modules",
  ".traceforge",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".vite",
  "dist",
  "build",
  "out",
  "coverage",
  ".nyc_output",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  "target",
];

function isExcludedSegment(segment: string, excludes: ReadonlySet<string>): boolean {
  return excludes.has(segment) || segment === ".env" || segment.startsWith(".env.");
}

export async function snapshotWorkspace(
  workspace: string,
  options: WorkspaceObserverOptions = {},
): Promise<WorkspaceManifest> {
  const maxFiles = options.maxFiles ?? 20_000;
  const maxHashBytes = options.maxHashBytes ?? 5 * 1024 * 1024;
  const excludes = new Set([...DEFAULT_EXCLUDED_DIRECTORIES, ...(options.extraExcludes ?? [])]);
  const files = new Map<string, string>();
  const directories = new Set<string>();
  let complete = true;
  const pending: string[] = [workspace];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }
    for (const entry of entries) {
      if (isExcludedSegment(entry.name, excludes)) continue;
      const absolute = join(directory, entry.name);
      const local = relative(workspace, absolute).replace(/\\/gu, "/");
      if (entry.isDirectory()) {
        directories.add(local);
        pending.push(absolute);
      } else if (entry.isFile()) {
        if (files.size >= maxFiles) {
          complete = false;
          continue;
        }
        try {
          const info = await stat(absolute, { bigint: true });
          if (info.size > BigInt(maxHashBytes)) {
            complete = false;
            continue;
          }
          const signature = `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
          const cached = options.cache?.get(absolute);
          if (
            cached &&
            cached.signature === signature &&
            info.mtimeNs + RACY_WINDOW_NS < cached.hashedAtNs
          ) {
            files.set(local, cached.hash);
            continue;
          }
          // Taken before reading, so a write during the read keeps the entry racy.
          const hashedAtNs = BigInt(Date.now()) * 1_000_000n;
          const hash = createHash("sha256").update(await readFile(absolute)).digest("hex");
          const after = await stat(absolute, { bigint: true });
          if (`${after.ino}:${after.size}:${after.mtimeNs}:${after.ctimeNs}` !== signature) {
            complete = false;
            options.cache?.delete(absolute);
            continue;
          }
          options.cache?.set(absolute, { signature, hash, hashedAtNs });
          files.set(local, hash);
        } catch {
          complete = false;
        }
      }
    }
  }
  return { files, directories, complete };
}

export function diffWorkspace(
  before: WorkspaceManifest,
  after: WorkspaceManifest,
): readonly WorkspaceChange[] {
  const changes: WorkspaceChange[] = [];
  for (const directory of after.directories)
    if (before.complete && !before.directories.has(directory))
      changes.push({ path: directory, kind: "DIRECTORY_CREATED", hashBefore: null, hashAfter: null });
  for (const [path, hash] of after.files) {
    const previous = before.files.get(path);
    if (previous === undefined && before.complete)
      changes.push({ path, kind: "FILE_CREATED", hashBefore: null, hashAfter: hash });
    else if (previous !== undefined && previous !== hash)
      changes.push({ path, kind: "FILE_MODIFIED", hashBefore: previous, hashAfter: hash });
  }
  for (const [path, hash] of before.files)
    if (after.complete && !after.files.has(path))
      changes.push({ path, kind: "FILE_DELETED", hashBefore: hash, hashAfter: null });
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Digest of the observed workspace state, used to bind claim records to an artifact. */
export function workspaceDigest(manifest: WorkspaceManifest): string {
  const hash = createHash("sha256");
  for (const path of [...manifest.files.keys()].sort())
    hash.update(`${path}\0${manifest.files.get(path)}\n`);
  return hash.digest("hex");
}

/**
 * Parses pass/fail/skip counts from common test runners (review fix T3).
 * Summary lines are preferred over file/suite counts: Vitest prints
 * "Test Files 2 passed" before "Tests 12 passed"; Jest prints
 * "Test Suites: 1 failed, 3 passed" before "Tests: 2 failed, 40 passed".
 */
export function parseTestCounts(output: string | undefined): Record<string, number> {
  if (!output) return {};
  const text = output.replace(/\u001b\[[0-9;]*m/gu, "");
  const countsFrom = (line: string): Record<string, number> => {
    const values: Record<string, number> = {};
    const pick = (pattern: RegExp, key: string) => {
      const match = pattern.exec(line);
      if (match) values[key] = Number(match[1]);
    };
    pick(/(\d+)\s+passed\b/iu, "passed");
    pick(/(\d+)\s+failed\b/iu, "failed");
    pick(/(\d+)\s+(?:skipped|pending|todo)\b/iu, "skipped");
    // A runner's summary line that reports passes and no failures means zero
    // failures (e.g. Vitest "Tests 7 passed (7)", pytest "5 passed in 0.1s").
    if (values.passed !== undefined && values.failed === undefined) values.failed = 0;
    return values;
  };
  // Vitest: "      Tests  12 passed (12)"; Jest: "Tests:       2 failed, 40 passed, 42 total"
  const summary = /^\s*Tests:?\s+(?!Files)(.*\d+\s+(?:passed|failed).*)$/imu.exec(text);
  if (summary) return countsFrom(summary[1]!);
  // node:test (TAP "# pass 6" or spec reporter "ℹ pass 6")
  const nodePass = /^\s*(?:#|ℹ)\s*pass\s+(\d+)\s*$/imu.exec(text);
  const nodeFail = /^\s*(?:#|ℹ)\s*fail\s+(\d+)\s*$/imu.exec(text);
  if (nodePass || nodeFail) {
    const values: Record<string, number> = {};
    if (nodePass) values.passed = Number(nodePass[1]);
    if (nodeFail) values.failed = Number(nodeFail[1]);
    const skipped = /^\s*(?:#|ℹ)\s*skipped\s+(\d+)\s*$/imu.exec(text);
    if (skipped) values.skipped = Number(skipped[1]);
    return values;
  }
  // pytest: "===== 3 failed, 17 passed in 0.52s ====="
  const pytest = /^=+\s*(.*\b(?:passed|failed)\b.*)\s+in\s+[\d.]+s/imu.exec(text);
  if (pytest) return countsFrom(pytest[1]!);
  // Fallback: last line that reports counts and is not a file/suite summary.
  const lines = text
    .split(/\r?\n/u)
    .filter((line) => /\d+\s+(?:passed|failed)\b/iu.test(line))
    .filter((line) => !/\b(?:Test\s+Files|Test\s+Suites|Suites?)\b/iu.test(line));
  return lines.length > 0 ? countsFrom(lines[lines.length - 1]!) : {};
}
