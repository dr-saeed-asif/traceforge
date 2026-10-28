#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, readJsonl, sha256 } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(import.meta.dirname, "../..");
const datasetPath = resolve(
  args.dataset ?? resolve(root, "research/datasets/natural-v1-adjudicated.jsonl"),
);
const runsRoot = resolve(args["out-dir"] ?? resolve(root, "research/runs"));
const model = String(args.model ?? "qwen3:4b");
const matching = String(args.matching ?? "exact");
const bootstrap = String(args.bootstrap ?? "1000");
const seed = String(args.seed ?? "42");
const dryRun = args["dry-run"] === true;
const skipBuild = args["skip-build"] === true;
const allowUnadjudicated = args["allow-unadjudicated"] === true;

if (!["exact", "relaxed"].includes(matching)) {
  throw new Error("--matching must be exact or relaxed.");
}
const datasetExists = existsSync(datasetPath);
if (!datasetExists && !dryRun) {
  throw new Error(
    `Adjudicated dataset not found: ${datasetPath}\n` +
      "Build it with build-adjudicated-dataset.mjs after two independent annotations and human adjudication.",
  );
}
if (!datasetExists) console.error(`Dry run: adjudicated dataset does not exist yet: ${datasetPath}`);
const cases = datasetExists ? readJsonl(datasetPath) : [];
if (datasetExists && !cases.length) throw new Error("Adjudicated dataset is empty.");
for (const item of cases) {
  const accepted = item.annotationStatus === "adjudicated" ||
    (allowUnadjudicated && ["controlled", "unannotated"].includes(item.annotationStatus));
  if (!accepted) {
    throw new Error(
      `${item.id}: annotationStatus ${JSON.stringify(item.annotationStatus)} is not accepted. ` +
        "Use adjudicated labels, or --allow-unadjudicated only for controlled/smoke-test data.",
    );
  }
  if (!Array.isArray(item.goldClaims)) {
    throw new Error(`${item.id}: goldClaims must be an array.`);
  }
}

const evaluations = [
  {
    name: "01-oracle-heuristic-deterministic-accept-regex",
    extractors: "oracle,heuristic",
    baselines: "deterministic,accept,regex",
    judge: false,
  },
  {
    name: "02-ollama-deterministic",
    extractors: "ollama",
    baselines: "deterministic",
    judge: false,
  },
  {
    name: "03-llm-judge",
    extractors: "oracle",
    baselines: "llm",
    judge: true,
  },
  {
    name: "04-agent-judge",
    extractors: "oracle",
    baselines: "agent",
    judge: true,
  },
  {
    name: "05-ollama-deterministic-accept-regex",
    extractors: "ollama",
    baselines: "deterministic,accept,regex",
    judge: false,
  },
];
const only = args.only
  ? String(args.only).split(",").map((value) => value.trim()).filter(Boolean)
  : null;
const selectedEvaluations = only
  ? evaluations.filter((evaluation) => only.some((prefix) => evaluation.name.startsWith(prefix)))
  : evaluations;
if (only && !selectedEvaluations.length) {
  throw new Error(`--only did not match an evaluation. Available: ${evaluations.map((item) => item.name).join(", ")}`);
}

if (!skipBuild) {
  const buildCommand = [
    process.execPath,
    resolve(root, "node_modules/typescript/bin/tsc"),
    "-p",
    resolve(root, "tsconfig.json"),
  ];
  if (dryRun) {
    console.log(`Build: ${buildCommand.map((part) => JSON.stringify(part)).join(" ")}`);
  } else {
    const build = spawnSync(buildCommand[0], buildCommand.slice(1), {
      cwd: root,
      stdio: "inherit",
    });
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(`TypeScript build failed with exit status ${build.status}.`);
  }
}

const runId = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
const datasetName = basename(datasetPath)
  .replace(/\.jsonl$/iu, "")
  .replace(/[^a-z0-9._-]+/giu, "-");
const base = resolve(runsRoot, `${datasetName}-${runId}`);
const evaluatePath = resolve(root, "dist/evaluate.js");
if (!dryRun && !existsSync(evaluatePath)) {
  throw new Error(`Missing ${evaluatePath}; the TypeScript build did not produce it.`);
}
if (!dryRun) mkdirSync(base, { recursive: true });
console.log(`Run directory: ${base}`);

const results = [];
for (const evaluation of selectedEvaluations) {
  const output = resolve(base, evaluation.name);
  const command = [
    evaluatePath,
    "--dataset",
    datasetPath,
    "--extractors",
    evaluation.extractors,
    "--baselines",
    evaluation.baselines,
    "--matching",
    matching,
    "--cluster",
    "session",
    "--bootstrap",
    bootstrap,
    "--seed",
    seed,
    "--output",
    output,
  ];
  if (evaluation.judge) command.push("--judge-model", model);
  if (args["cache-extractions"] === true) command.push("--cache-extractions");
  if (allowUnadjudicated) command.push("--allow-unadjudicated");
  const env = {
    ...process.env,
    TRACEFORGE_LLM_MODEL: model,
    TRACEFORGE_JUDGE_MODEL: model,
  };
  console.log(`\n[${evaluation.name}] ${process.execPath} ${command.map((part) => JSON.stringify(part)).join(" ")}`);
  if (dryRun) {
    results.push({ ...evaluation, output, command: [process.execPath, ...command], dryRun: true });
    continue;
  }
  const startedAt = new Date().toISOString();
  const run = spawnSync(process.execPath, command, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();
  const logPath = resolve(base, `${evaluation.name}.log`);
  writeFileSync(
    logPath,
    [
      `$ ${process.execPath} ${command.map((part) => JSON.stringify(part)).join(" ")}`,
      `exitStatus=${run.status}`,
      `signal=${run.signal ?? ""}`,
      "",
      "STDOUT",
      run.stdout ?? "",
      "",
      "STDERR",
      run.stderr ?? "",
    ].join("\n"),
    "utf8",
  );
  results.push({
    ...evaluation,
    output,
    log: logPath,
    exitStatus: run.status,
    signal: run.signal,
    error: run.error ? run.error.message : null,
    startedAt,
    finishedAt,
  });
}

const suiteManifest = {
  schemaVersion: 1,
  runId,
  createdAt: new Date().toISOString(),
  dataset: datasetPath,
  datasetSha256: datasetExists ? sha256(readFileSync(datasetPath)) : null,
  sessions: cases.length,
  claims: cases.reduce((sum, item) => sum + item.goldClaims.length, 0),
  model,
  matching,
  bootstrap: Number(bootstrap),
  seed: Number(seed),
  allowUnadjudicated,
  dryRun,
  outputDirectory: dryRun ? null : base,
  evaluations: results,
};
if (!dryRun) {
  writeFileSync(resolve(base, "suite-manifest.json"), JSON.stringify(suiteManifest, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify(suiteManifest, null, 2));

const failures = results.filter((result) => !result.dryRun && result.exitStatus !== 0);
if (failures.length) {
  console.error(`\n${failures.length} evaluation(s) failed. See ${base}.`);
  process.exitCode = 1;
}
