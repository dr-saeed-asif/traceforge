#!/usr/bin/env node
// Run both benchmark stages without replacing bundled or previous results.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.reduce((pairs, value, index) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), argv[index + 1]]);
  return pairs;
}, []));
const old = resolve(args.old ?? join(root, "../tf-old"));
if (!existsSync(join(old, "dist/modules/verification/application/claim-verifier.js")))
  throw new Error("Build the original checkout first and provide --old <checkout>; see research/benchmark/README.md");
const output = resolve(args.out ?? join(root, ".traceforge/benchmark-runs", `${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`));
const run = (script, parameters) => {
  const result = spawnSync(process.execPath, [join(root, "research/benchmark", script), ...parameters], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const extra = ["variants", "seed", "python", "shell"].flatMap(name => args[name] === undefined ? [] : [`--${name}`, args[name]]);
run("run-controlled-benchmark.mjs", ["--new", root, "--old", old, "--out", output, ...extra]);
run("run-consumer-gate.mjs", ["--root", root, "--results", output]);
console.log(`Benchmark results: ${output}`);
