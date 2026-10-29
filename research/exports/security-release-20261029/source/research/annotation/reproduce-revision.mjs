#!/usr/bin/env node
// Fresh controlled execution and evaluation. Never supplies predictions as gold.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, openSync, closeSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs, sha256 } from "./lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const args = parseArgs(process.argv.slice(2));
const resuming = typeof args["resume-dir"] === "string";
const out = resolve(args["resume-dir"] ?? args["out-dir"] ?? join(root, "research/runs", `revision-${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0,8)}`));
const old = resolve(args.old ?? "../traceforge-original-reference-20261028");
const python = resolve(args.python ?? ".traceforge/revision-20261028/venv/Scripts/python.exe");
const model = String(args.model ?? "qwen3:4b");
const contextTokens = Number(args["context-tokens"] ?? 4096);
if (!Number.isSafeInteger(contextTokens) || contextTokens < 1024) throw new Error("Invalid --context-tokens");
if (existsSync(out) && !resuming) throw new Error(`Use a fresh directory: ${out}`);
mkdirSync(out, { recursive: true });
const commands = resuming ? JSON.parse(readFileSync(join(out, "reproduction-manifest.json"))).commands : [];
const run = (name, argv, extraEnv = {}) => {
  if (resuming && commands.some(c=>c.name===name && c.exitCode===0)) { console.log(`Reusing completed stage: ${name}`); return; }
  const attemptName = commands.some(c=>c.name===name) ? `${name}-retry-${commands.filter(c=>c.name.startsWith(name)).length}` : name;
  console.log(`[${new Date().toISOString()}] ${name}`);
  const stdout = openSync(join(out, `${attemptName}.stdout.log`), "wx");
  const stderr = openSync(join(out, `${attemptName}.stderr.log`), "wx");
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, argv, { cwd: root, env: { ...process.env, TRACEFORGE_LLM_CONTEXT_TOKENS:String(contextTokens), ...extraEnv }, stdio: ["ignore", stdout, stderr] });
  closeSync(stdout); closeSync(stderr);
  commands.push({ name, attemptName, requestedContextTokens:contextTokens, command: [process.execPath, ...argv], startedAt, finishedAt: new Date().toISOString(), exitCode: result.status, error: result.error?.message ?? null });
  writeFileSync(join(out, "reproduction-manifest.json"), JSON.stringify({ model, requestedContextTokens:contextTokens, oldCheckout: old, python, output: out, commands }, null, 2));
  if (result.status !== 0) throw new Error(`${name} failed (${result.status}): ${readFileSync(join(out, `${attemptName}.stderr.log`), "utf8").slice(-3000)}`);
};
run(resuming ? `build-core-context${contextTokens}` : "build-core", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"]);
run("build-adapter", ["node_modules/typescript/bin/tsc", "-p", "packages/adapter-opencode/tsconfig.json"]);
const tags = await fetch("http://127.0.0.1:11434/api/tags").then(r => r.json());
const version = await fetch("http://127.0.0.1:11434/api/version").then(r => r.json());
if (!tags.models.some(m => m.name === model)) throw new Error(`Missing Ollama model ${model}`);
writeFileSync(join(out, "ollama-environment.json"), JSON.stringify({ version, tags, selectedModel: tags.models.find(m => m.name === model) }, null, 2));
const benchmark = join(out, "controlled-benchmark");
run("execute-controlled-benchmark", ["research/benchmark/run-controlled-benchmark.mjs", "--new", root, "--old", old, "--out", benchmark, "--variants", "8", "--seed", "7", "--python", python]);
run("consumer-gate", ["research/benchmark/run-consumer-gate.mjs", "--root", root, "--results", benchmark]);
const dataset = join(out, "controlled-reproduced.jsonl");
run("convert-controlled-data", ["research/annotation/build-controlled-dataset.mjs", "--sessions", join(benchmark, "sessions.jsonl"), "--summary", join(benchmark, "summary.json"), "--rows", join(benchmark, "rows.jsonl"), "--output", dataset, "--export-dir", join(out, "controlled-csv")]);
writeFileSync(join(out, "dataset-sha256.txt"), sha256(readFileSync(dataset)) + "\n");
for (const [name, extractors, baselines] of [
  ["01-oracle-heuristic", "oracle,heuristic", "deterministic,accept,regex"],
  ["02-ollama", "ollama", "deterministic,accept,regex"],
  ["03-llm-judge", "oracle", "llm"],
  ["04-agent-judge", "oracle", "agent"],
]) {
  if (args["skip-judges"] === true && ["llm", "agent"].includes(baselines)) {
    console.log(`Not run: ${name}; judge evaluation deferred until genuine natural annotations are available.`);
    continue;
  }
  const stageOut = existsSync(join(out,name)) && !commands.some(c=>c.name===name && c.exitCode===0) ? `${name}-context${contextTokens}` : name;
  run(name, ["dist/evaluate.js", "--dataset", dataset, "--extractors", extractors, "--baselines", baselines, "--judge-model", model, "--allow-unadjudicated", "--cache-extractions", "--bootstrap", "2000", "--matching", "exact", "--output", join(out, stageOut)], { TRACEFORGE_LLM_MODEL: model, TRACEFORGE_JUDGE_MODEL: model });
}
run("export-evaluation-csv", ["research/annotation/export-evaluation-suite.mjs", "--run-dir", out, "--dataset", dataset, "--out-dir", join(out, "evaluation-csv")]);
console.log(JSON.stringify({ output: out, status: "COMPLETE", commands: commands.length }, null, 2));
