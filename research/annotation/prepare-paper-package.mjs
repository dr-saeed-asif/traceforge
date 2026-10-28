#!/usr/bin/env node
// Package source-backed CSVs without changing source data or running evaluations.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs, readJsonl, toCsv, sha256 } from "./lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const args = parseArgs(process.argv.slice(2));
const out = resolve(args["out-dir"] ?? join(root, "research/exports", `paper-package-${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`));
if (existsSync(out)) throw new Error(`Use a fresh output directory: ${out}`);
mkdirSync(out, { recursive: true });
const inventory = [["file", "purpose", "provenance", "status", "sha256"]];
function record(file, purpose, source, status) {
  inventory.push([relative(out, file).replaceAll("\\", "/"), purpose, source, status, sha256(readFileSync(file))]);
}
function csv(name, rows, purpose, source, status = "EXPORTED_EXISTING_DATA") {
  const file = join(out, name); mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, toCsv(rows), { flag: "wx" }); record(file, purpose, source, status);
}
function copy(source, name, purpose, status = "EXPORTED_EXISTING_DATA") {
  const file = join(out, name); mkdirSync(resolve(file, ".."), { recursive: true });
  copyFileSync(join(root, source), file); record(file, purpose, source, status);
}
function run(script, parameters) {
  const result = spawnSync(process.execPath, [join(root, "research/annotation", script), ...parameters], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || result.stdout);
  return result.stdout;
}
const naturalPath = join(root, "research/datasets/natural-v1.jsonl");
const natural = readJsonl(naturalPath);
const humanDir = join(out, "human-annotation");
run("prepare-worksheets.mjs", ["--dataset", naturalPath, "--out-dir", humanDir]);
for (const slot of ["a", "b"]) record(join(humanDir, `natural-v1.annotator-${slot}.csv`), "Independent blinded human annotation; no labels filled", "research/datasets/natural-v1.jsonl", "HUMAN_INPUT_REQUIRED");
const template = readFileSync(join(root, "research/annotation/adjudication-template.csv"), "utf8").trim();
writeFileSync(join(humanDir, "natural-v1.adjudications.csv"), template + "\n", { flag: "wx" });
record(join(humanDir, "natural-v1.adjudications.csv"), "Adjudicator fills one row per reconciled claim, or one NO_CLAIMS row per session", "research/annotation/adjudication-template.csv", "HEADER_ONLY_HUMAN_INPUT_REQUIRED");
copy("research/annotation/README.md", "human-annotation/INSTRUCTIONS.md", "Annotation protocol and direct Node commands", "INSTRUCTIONS");
csv("natural-dataset-audit.csv", [["session_id", "annotation_status", "gold_claims", "evidence_events", "final_response_available", "agent_model", "source_sha256"], ...natural.map(s => [s.id, s.annotationStatus, s.goldClaims.length, s.evidence.length, Boolean(s.finalResponse), s.metadata?.model, sha256(readFileSync(naturalPath))])], "Dataset completeness audit; zero gold claims is not NO_CLAIMS", "research/datasets/natural-v1.jsonl", "UNANNOTATED");

for (const [source, name, purpose] of [
  ["research/exports/controlled-v1/benchmark-summary.csv", "table-06-controlled-results.csv", "Paper Table 6 plus macro F1 and ablations; rates are fractions"],
  ["research/exports/controlled-v1/benchmark-families.csv", "table-07-controlled-families.csv", "Paper Table 7 source data"],
  ["research/exports/controlled-v1/benchmark-per-claim.csv", "controlled-per-claim.csv", "Bundled controlled benchmark per-claim outputs"],
  ["research/pilot/dashboard-counts.csv", "table-10-pilot-dashboard-counts.csv", "Paper Table 10; screenshot transcription, not ground truth"],
  ["research/exports/controlled-v1/sessions.csv", "controlled-sessions.csv", "Controlled sessions"],
  ["research/exports/controlled-v1/gold-claims.csv", "controlled-gold-claims.csv", "Controlled claims known by construction; not human natural labels"],
  ["research/exports/controlled-v1/evidence.csv", "controlled-evidence.csv", "Controlled evidence references"],
]) copy(source, name, purpose);
const gate = JSON.parse(readFileSync(join(root, "research/benchmark/results/consumer-gate.json")));
csv("table-08-consumer-gate.csv", [["system", "sessions", "agreement", "unsafe_accept_rate", "false_reject_rate"], ...gate.results.map(r => [r.system, r.sessions, r.agreement, r.unsafeAcceptRate, r.falseRejectRate])], "Consumer gate metrics; fractions", "research/benchmark/results/consumer-gate.json");
csv("consumer-tamper-checks.csv", [["check", "rejected", "attempts"], ...["editedPayload", "foreignKey", "swappedArtifact"].map(k => [k, gate.tamper[k], k === "swappedArtifact" ? gate.tamper.swapAttempts : gate.tamper.n])], "Bundled gate tamper checks", "research/benchmark/results/consumer-gate.json");
const overhead = JSON.parse(readFileSync(join(root, "research/benchmark/results/snapshot-overhead.json")));
csv("table-09-snapshot-overhead.csv", [["workspace", "files", "median_no_cache_ms", "median_warm_cache_ms", "speedup", "runs", "digest_identical", "node", "cpu", "cores", "memory_gib", "kernel"], ...overhead.results.map(r => [r.workspace, r.files, r.medianMsNoCache, r.medianMsWarmCache, r.medianMsNoCache / r.medianMsWarmCache, r.runs, r.digestIdentical, overhead.node, overhead.cpu, overhead.cores, overhead.memGiB, overhead.kernel])], "Historical snapshot timings on recorded Linux hardware; not measured on this host", "research/benchmark/results/snapshot-overhead.json");
csv("table-11-single-run-observation.csv", [["measure", "value", "unit", "provenance", "limitation"], ["agent_execution", 44.2, "s", "Attached manuscript Table 11", "Single dashboard observation; not independently reconstructed"], ["time_to_first_tool", 6.2, "s", "Attached manuscript Table 11", "Single dashboard observation"], ["extraction", 330, "s", "Attached manuscript Table 11", "May include loading/retries/save; not a population estimate"], ["verification", 8, "ms", "Attached manuscript Table 11", "Includes access and persistence"], ["extraction_model", "qwen3:4b", "model", "Attached manuscript Table 11", "Machine configuration unavailable"], ["tests_passed", 6, "tests", "Attached manuscript Table 11", "Dashboard observation"], ["tests_failed", 0, "tests", "Attached manuscript Table 11", "Dashboard observation"]], "Explicit manuscript transcription, not newly measured results", "C:/Users/asifs/Downloads/ACM_Web_Transaction___Agentic_AI (1).pdf Table 11", "MANUSCRIPT_TRANSCRIPTION");

const evaluations = [["oracle,heuristic", "deterministic,accept,regex"], ["ollama", "deterministic"], ["oracle", "llm"], ["oracle", "agent"], ["ollama", "deterministic,accept,regex"]];
csv("natural-evaluation-status.csv", [["extractors", "baselines", "model", "status", "reason"], ...evaluations.map(([e,b]) => [e,b,"qwen3:4b","NOT_RUN", "No genuine completed adjudications available"])], "Pending natural study; no accuracy values are invented", "Dataset and annotation audit", "HUMAN_INPUT_REQUIRED");
csv("study-requirements.csv", [["requirement", "paper_target", "observed", "status", "source"], ["sessions",150,natural.length,natural.length>=150?"TARGET_MET":"MORE_COLLECTION_REQUIRED","Manuscript section 7.8"], ["agent_models",3,new Set(natural.map(s=>s.metadata?.model).filter(Boolean)).size,"MORE_COLLECTION_REQUIRED","Manuscript section 7.8"], ["languages",3,"","HUMAN_METADATA_REQUIRED","Manuscript section 7.8"], ["test_runners",4,"","HUMAN_METADATA_REQUIRED","Manuscript section 7.8"], ["independent_annotators",2,0,"HUMAN_ANNOTATION_REQUIRED","Blank source worksheets"], ["adjudicated_sessions",natural.length,0,"HUMAN_ADJUDICATION_REQUIRED","Current frozen export"], ["span_type_verdict_agreement","raw agreement and Cohen kappa","","HUMAN_LABELS_REQUIRED","Annotation protocol"]], "Study target and pending inputs; unknown metadata stays blank", "Manuscript section 7.8 and natural-v1 audit", "STUDY_INCOMPLETE");
csv("table-12-evaluation-status.csv", [["component", "status", "evidence_or_missing_input"], ["controlled_accuracy_and_ablations","EXISTING_RESULTS","Tables 6/7 CSVs; controlled benchmark only"], ["consumer_gate","EXISTING_RESULTS","Table 8 and tamper CSVs"], ["snapshot_overhead","EXISTING_RESULTS","Table 9 CSV; historical hardware"], ["pilot_distribution","OBSERVATION_ONLY","Table 10 CSV; screenshot transcription"], ["single_run_timing","OBSERVATION_ONLY","Table 11 CSV; manuscript transcription"], ["natural_accuracy_and_judges","PENDING","Independent annotation, adjudication, more session collection"], ["public_network_measurements","PENDING","Real Sepolia/Sui receipts, fees and timings"]], "Paper study status", "Manuscript Table 12 plus current repository audit");

// Export each existing complete evaluation separately; never replace bundled CSVs.
for (const entry of readdirSync(join(root, "research/runs"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const runDir = join(root, "research/runs", entry.name);
  const dirs = readdirSync(runDir, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(runDir, d.name, "metrics.json")));
  if (!dirs.length) continue;
  const frozen = join(runDir, dirs[0].name, "dataset.jsonl");
  if (!existsSync(frozen)) continue;
  const exportDir = join(out, "existing-evaluations", entry.name);
  run("export-evaluation-suite.mjs", ["--run-dir", runDir, "--dataset", frozen, "--out-dir", exportDir]);
  for (const file of readdirSync(exportDir)) record(join(exportDir, file), "Existing controlled evaluation; not natural-study accuracy or a new run", relative(root, runDir), "EXPORTED_EXISTING_DATA");
}
const checks = [["check", "exit_code", "status", "detail"]];
const incomplete = spawnSync(process.execPath, [join(root, "research/annotation/build-adjudicated-dataset.mjs"), "--dataset", naturalPath, "--annotations", join(humanDir, "natural-v1.adjudications.csv"), "--dry-run"], { cwd: root, encoding: "utf8" });
if (incomplete.status === 0) throw new Error("Blank adjudications were unexpectedly accepted.");
checks.push(["blank_adjudication_rejected", incomplete.status, "EXPECTED_REJECTION", "All 40 sessions require genuine human adjudication"]);
writeFileSync(join(out, "incomplete-adjudication.log"), incomplete.stderr);
const plan = run("run-evaluation-suite.mjs", ["--dry-run", "--model", "qwen3:4b"]);
writeFileSync(join(out, "evaluation-command-plan.log"), plan);
checks.push(["evaluation_command_plan", 0, "DRY_RUN_ONLY", "Five direct-Node configurations; qwen3:4b; separate fresh output directories; no evaluation executed"]);
csv("preparation-checks.csv", checks, "Actual preparation validation and pending evaluations", "Direct Node CLI checks", "PREPARATION_ONLY");
writeFileSync(join(out, "file-inventory.csv"), toCsv(inventory), { flag: "wx" });
writeFileSync(join(out, "README.md"), `# TraceForge paper CSV package\n\nGenerated from existing repository evidence. No human labels or natural-study accuracy were invented. All rates are fractions (multiply by 100 for percentages). See file-inventory.csv for provenance and SHA-256.\n\n## Human annotation\n\nGive human-annotation/natural-v1.annotator-a.csv only to annotator A and the B file only to annotator B, plus human-annotation/INSTRUCTIONS.md. Both label independently. Give the adjudication template to the adjudicator after both finish. Every session must be reviewed, including genuinely claim-free responses. Keep original independent files. No predicted claims or verdicts are included in these worksheets.\n\n## Results boundaries\n\nTables 6-9 are existing controlled benchmark measurements, Table 10 is pilot screenshot data, and Table 11 transcribes the attached manuscript's single-run observation. Existing-evaluations exports current-policy controlled runs separately: they are not replacements for the historical policy 2.0/2.1 tables. Natural evaluation status is NOT_RUN. Public-network receipts and human agreement remain unavailable.\n\nThe current export has 40 sessions, two recorded agent models and zero independently labelled gold claims. It falls below the manuscript target of 150 sessions and three models. Language and runner coverage require collection metadata. Some prompts prescribe the exact final answer, so authors must review sampling before calling this a representative natural-report corpus.\n\n## Commands after genuine annotation\n\nRun from the repository root, using Node directly.\n\n\`\`\`powershell\nnode research/annotation/build-adjudicated-dataset.mjs --annotations "${join(humanDir, "natural-v1.adjudications.csv")}" --dry-run\nnode research/annotation/build-adjudicated-dataset.mjs --annotations "${join(humanDir, "natural-v1.adjudications.csv")}"\nnode research/annotation/run-evaluation-suite.mjs --model qwen3:4b\nnode research/annotation/export-evaluation-suite.mjs --run-dir "<new suite directory>" --dataset research/datasets/natural-v1-adjudicated.jsonl --out-dir "<fresh export directory>"\n\`\`\`\n\nThe converter validates structure, quotes, evidence membership and completion markers; humans remain responsible for semantic correctness, claim coverage and provenance. It cannot prove that entered labels came from independent humans. The eight-type evaluator does not support OTHER: retain such claims in notes, report excluded counts and resolve this protocol limitation before claiming full natural-report extraction coverage. For a reconciled claim missed by one annotator, use NOT_IDENTIFIED in that raw verdict field and explain the human reconciliation; never fabricate a verdict.\n`, { flag: "wx" });
console.log(JSON.stringify({ output: out, files: inventory.length - 1, naturalSessions: natural.length, naturalEvaluation: "NOT_RUN" }, null, 2));
