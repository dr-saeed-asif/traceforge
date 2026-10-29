#!/usr/bin/env node
/**
 * Workspace-snapshot overhead with and without the hash cache (review item 27).
 * Usage: node research/benchmark/measure-snapshot-overhead.mjs <workspace>... [--runs 7] [--synthetic 10000]
 * For each workspace: one warm-up pass, then `runs` timed snapshots without a
 * cache and `runs` timed snapshots with a warm cache (workspace unchanged).
 * Prints JSON; medians in milliseconds. Requires the adapter to be built.
 */
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir, cpus, totalmem, release } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const observer = await import(pathToFileURL(join(root, "packages/adapter-opencode/dist/workspace-observer.js")).href);
const argv = process.argv.slice(2);
const runs = argv.includes("--runs") ? Number(argv[argv.indexOf("--runs") + 1]) : 7;
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
const syntheticCount = argv.includes("--synthetic") ? Number(argv[argv.indexOf("--synthetic") + 1]) : 0;
if (!Number.isSafeInteger(syntheticCount) || syntheticCount < 0) throw new Error("--synthetic must be a nonnegative integer");
const workspaces = argv.filter((a, i) => !a.startsWith("--") && !["--runs", "--synthetic"].includes(argv[i - 1]));
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const time = async (fn) => { const t = process.hrtime.bigint(); await fn(); return Number(process.hrtime.bigint() - t) / 1e6; };

let synthetic;
if (syntheticCount > 0) {
  synthetic = mkdtempSync(join(tmpdir(), "tf-synth-"));
  const old = new Date(Date.now() - 60_000);
  for (let i = 0; i < syntheticCount; i += 1) {
    const dir = join(synthetic, `d${i % 100}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `f${i}.ts`);
    writeFileSync(file, `export const v${i} = ${i};\n`);
    utimesSync(file, old, old);
  }
  workspaces.push(synthetic);
}

const results = [];
for (const workspace of workspaces) {
  const probe = await observer.snapshotWorkspace(workspace); // warm OS page cache
  const noCache = [];
  for (let i = 0; i < runs; i += 1) noCache.push(await time(() => observer.snapshotWorkspace(workspace)));
  const cache = observer.createHashCache();
  await observer.snapshotWorkspace(workspace, { cache }); // fill the hash cache
  const warm = [];
  let same = true;
  for (let i = 0; i < runs; i += 1) {
    let manifest;
    warm.push(await time(async () => { manifest = await observer.snapshotWorkspace(workspace, { cache }); }));
    same &&= observer.workspaceDigest(manifest) === observer.workspaceDigest(probe);
  }
  results.push({ workspace: workspace === synthetic ? `synthetic-${syntheticCount}` : workspace, files: probe.files.size, complete: probe.complete,
    medianMsNoCache: +median(noCache).toFixed(1), medianMsWarmCache: +median(warm).toFixed(1), digestIdentical: same, runs });
}
if (synthetic) rmSync(synthetic, { recursive: true, force: true });
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, cores: cpus().length, memGiB: +(totalmem() / 2 ** 30).toFixed(1), kernel: release(), results }, null, 2));
