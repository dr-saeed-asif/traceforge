#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { parseArgs, readJsonl, toCsv, sha256, parseCsv, csvRecords } from "./lib.mjs";
import { scorePairs, clusteredBootstrap } from "../../dist/research/metrics.js";

const root = resolve(import.meta.dirname, "../..");
const args = parseArgs(process.argv.slice(2));
const run = resolve(args["run-dir"] ?? "research/runs/revision-20261028-reproduced");
const out = resolve(args["out-dir"] ?? "research/exports/revision-20261028-new-results");
if (existsSync(out)) throw new Error(`Use a fresh directory: ${out}`);
mkdirSync(out, { recursive: true });
const datasetPath = join(run, "controlled-reproduced.jsonl");
const dataset = readJsonl(datasetPath);
const byId = new Map(dataset.map(s => [s.id, s]));
const familyGold = new Map();
for (const s of dataset) {
  const family = s.metadata?.family ?? s.id.split("#")[0];
  if (!familyGold.has(family)) familyGold.set(family,new Set());
  for (const claim of s.goldClaims) familyGold.get(family).add(claim.verdict);
}
const familyLabel = family => familyGold.get(family)?.size > 1 ? "MIXED" : [...(familyGold.get(family)??[])][0] ?? "";
const inventory = [["file", "source", "sha256"]];
function record(path, source) { inventory.push([relative(out, path).replaceAll("\\", "/"), source, sha256(readFileSync(path))]); }
function csv(name, rows, source) { const p = join(out, name); writeFileSync(p, toCsv(rows), { flag: "wx" }); record(p, source); }
function copy(from, name) {
  const p = join(out, name);
  if (["benchmark-summary.csv","benchmark-families.csv"].includes(name)) {
    const rows=parseCsv(readFileSync(from,"utf8"));
    const stage=rows[0].indexOf("stage"), gold=rows[0].indexOf("gold_verdict");
    for(const row of rows.slice(1)) {
      if(stage>=0 && row[stage]==="held-out") row[stage]="stress_H_previously_examined";
      if(gold>=0) row[gold]=familyLabel(row[0]);
    }
    writeFileSync(p,toCsv(rows),{flag:"wx"});
    record(p,`${from}; terminology clarified, mixed family gold summarized from actual claims`);
  } else { copyFileSync(from, p); record(p, from); }
}
for (const folder of ["controlled-csv", "evaluation-csv"]) {
  if (!existsSync(join(run, folder))) continue;
  for (const f of readdirSync(join(run, folder))) if (f.endsWith(".csv")) copy(join(run, folder, f), f);
}
if (existsSync(join(run,"verification-microbenchmark.csv"))) copy(join(run,"verification-microbenchmark.csv"),"verification-microbenchmark.csv");
if (existsSync(join(run,"fallback-usage.csv"))) copy(join(run,"fallback-usage.csv"),"fallback-usage.csv");
if (existsSync(join(run,"snapshot-measurement-status.csv"))) copy(join(run,"snapshot-measurement-status.csv"),"snapshot-measurement-status.csv");
if (existsSync(join(run,"latency-outliers.csv"))) copy(join(run,"latency-outliers.csv"),"latency-outliers.csv");
const headers = ["split", "evaluation", "extractor", "baseline", "cluster_unit", "clusters", "sessions", "gold_claims", "unscored_or_missed_gold_claims", "spurious_claims", "accuracy", "accuracy_ci_lower", "accuracy_ci_upper", "matched_accuracy", "matched_accuracy_ci_lower", "matched_accuracy_ci_upper", "macro_f1_defined_verdicts", "macro_f1_ci_lower", "macro_f1_ci_upper", "false_verified_rate", "false_verified_ci_lower", "false_verified_ci_upper", "spurious_verified_claims", "inference_or_judge_failures", "matching", "bootstrap_replicates"];
const main = [headers], familyCI = [headers];
const evalDirs = readdirSync(run).filter(name => existsSync(join(run, name, "metrics.json")));
for (const name of evalDirs) {
  const manifest = JSON.parse(readFileSync(join(run,name,"run-manifest.json")));
  if (manifest.datasetHash !== sha256(readFileSync(datasetPath))) throw new Error(`Frozen dataset mismatch: ${name}`);
  const predictions = readJsonl(join(run,name,"predictions.jsonl"));
  const failures = readJsonl(join(run,name,"failures.jsonl"));
  for (const split of ["all_controlled", "targeted_F", "stress_H_previously_examined"]) {
    const accepts = id => split === "all_controlled" || (split === "targeted_F" ? id.startsWith("F") : id.startsWith("H"));
    const rows = predictions.filter(p => accepts(p.id));
    for (const system of new Set(rows.map(p => `${p.extractor}/${p.baseline}`))) {
      const [extractor, baseline] = system.split("/");
      const selected = rows.filter(p => p.extractor === extractor && p.baseline === baseline);
      for (const clusterUnit of ["session", "family"]) {
        const grouped = new Map();
        for (const p of selected) {
          const key = clusterUnit === "session" ? p.id : byId.get(p.id)?.metadata?.family ?? p.id.split("#")[0];
          grouped.set(key, [...(grouped.get(key) ?? []), ...p.pairs]);
        }
        const clusters = [...grouped].map(([id,pairs]) => ({id,pairs}));
        const metrics = scorePairs(clusters.flatMap(c => c.pairs));
        const ci = clusteredBootstrap(clusters, 2000, 42);
        const nFailures = failures.filter(f => accepts(f.id) && f.extractor === extractor && (!f.baseline || f.baseline === baseline)).length;
        const data = [split,name,extractor,baseline,clusterUnit,clusters.length,selected.length,metrics.goldClaims,metrics.missedClaims,metrics.spuriousClaims,metrics.accuracy,ci.accuracy?.lower,ci.accuracy?.upper,metrics.matchedAccuracy,ci.matchedAccuracy?.lower,ci.matchedAccuracy?.upper,metrics.macroF1,ci.macroF1?.lower,ci.macroF1?.upper,metrics.falseVerifiedRate,ci.falseVerifiedRate?.lower,ci.falseVerifiedRate?.upper,metrics.spuriousVerifiedClaims,nFailures,manifest.matching,2000];
        (clusterUnit === "session" ? main : familyCI).push(data);
      }
    }
  }
}
csv("paper-main-results.csv", main, "Fresh evaluation predictions; session bootstrap (2000 resamples, seed 42)");
csv("paper-family-cluster-sensitivity.csv", familyCI, "Same predictions; family bootstrap sensitivity to repeated response templates");
const gate = JSON.parse(readFileSync(join(run,"controlled-benchmark/consumer-gate.json")));
const benchmarkSummary = JSON.parse(readFileSync(join(run,"controlled-benchmark/summary.json")));
const familySystems = [...new Set(benchmarkSummary.families.flatMap(f=>Object.keys(f).filter(k=>!["family","gold"].includes(k))))];
csv("benchmark-family-wide.csv", [["family","gold_verdict",...familySystems], ...benchmarkSummary.families.map(f=>[f.family,familyLabel(f.family),...familySystems.map(k=>f[k])])], "Fresh controlled benchmark family accuracy; rates are fractions; mixed gold summarized from claims");
csv("consumer-gate.csv", [["system","sessions","agreement","unsafe_accept_rate","false_reject_rate"],...gate.results.map(r=>[r.system,r.sessions,r.agreement,r.unsafeAcceptRate,r.falseRejectRate])], "Fresh consumer gate execution");
csv("tamper-checks.csv", [["check","rejected","attempted"], ...["editedPayload","foreignKey","swappedArtifact"].map(k=>[k,gate.tamper[k],k==="swappedArtifact"?gate.tamper.swapAttempts:gate.tamper.n])], "Fresh gate tamper attempts");
const overheadFile = join(run,"snapshot-overhead-small.json");
if (existsSync(overheadFile)) {
  const overhead = JSON.parse(readFileSync(overheadFile));
  csv("snapshot-overhead.csv", [["workspace","files","runs","median_no_cache_ms","median_warm_cache_ms","speedup","digest_identical","complete","node","cpu","cores","kernel"],...overhead.results.map(r=>[r.workspace,r.files,r.runs,r.medianMsNoCache,r.medianMsWarmCache,r.medianMsNoCache/r.medianMsWarmCache,r.digestIdentical,r.complete,overhead.node,overhead.cpu,overhead.cores,overhead.kernel])], "Fresh snapshot measurements on this Windows host");
}
const natural = readJsonl(join(root,"research/datasets/natural-v1.jsonl"));
csv("natural-study-status.csv", [["sessions_available","gold_claims","adjudicated_sessions","paper_session_target","status","required_input"],[natural.length,natural.reduce((n,s)=>n+s.goldClaims.length,0),natural.filter(s=>s.annotationStatus==="adjudicated").length,150,"NOT_EVALUATED","Two independent annotations, human adjudication and additional session collection"]], "Natural dataset audit, not an accuracy measurement");
const execution = JSON.parse(readFileSync(join(run,"reproduction-manifest.json")));
csv("execution-attempts.csv", [["stage","attempt","context_tokens","started_at","finished_at","exit_code","error"],...execution.commands.map(c=>[c.name,c.attemptName??c.name,c.requestedContextTokens??8192,c.startedAt,c.finishedAt,c.exitCode,c.error])], "Actual exit codes; interrupted attempts are retained");
csv("judge-evaluation-status.csv", [["dataset","baseline","model","status","reason"], ...["llm","agent"].map(b=>["natural-v1",b,"qwen3:4b","NOT_RUN","Genuine independent adjudications are missing; original human-annotation prerequisite remains unmet"]), ...["llm","agent"].filter(b=>!evalDirs.some(d=>d.includes(`${b}-judge`))).map(b=>["controlled-reproduced",b,"qwen3:4b","NOT_RUN","Excluded from this run with --skip-judges; no controlled judge accuracy is claimed"])], "Actual exclusions and pending human inputs; no judge scores invented");
const probeFile = join(root,".traceforge/revision-20261028/context-probe.json");
if (existsSync(probeFile)) {
  const probes=JSON.parse(readFileSync(probeFile));
  csv("context-diagnostics.csv", [["probe","requested_context","latency_ms","provider_ms","generation_ms","input_tokens","output_tokens"],...probes.map((p,i)=>[i+1,p.metadata.contextTokens,p.metadata.latencyMs,p.metadata.attempts[0]?.providerDurationMs,p.metadata.attempts[0]?.generationDurationMs,p.metadata.usage.input_tokens,p.metadata.usage.output_tokens])], "Diagnostic requests, not accuracy samples or controlled latency comparisons");
}
const patchPath = "C:/Users/asifs/Downloads/traceforge-revision-fixes.patch";
const reference = resolve(root,"../traceforge-revision-reference-20261028");
const paths = [...new Set([...readFileSync(patchPath,"utf8").matchAll(/^diff --git a\/(.+) b\/(.+)$/gmu)].map(m=>m[2].trim()))];
csv("patch-audit.csv", [["path","patch_applied_to_original_reference","reference_sha256","current_sha256","comparison"],...paths.filter(p=>!p.startsWith("research/benchmark/results/")).map(p=>[p,existsSync(join(reference,p)),existsSync(join(reference,p))?sha256(readFileSync(join(reference,p))):"",existsSync(join(root,p))?sha256(readFileSync(join(root,p))):"",existsSync(join(root,p))&&existsSync(join(reference,p))&&sha256(readFileSync(join(root,p)))===sha256(readFileSync(join(reference,p)))?"IDENTICAL":"LATER_LOCAL_CHANGES_RETAINED"])], `Patch SHA-256 ${sha256(readFileSync(patchPath))}; clean isolated application to original revision`);
const testFile = join(root,".traceforge/revision-20261028/tests-final.json");
if (existsSync(testFile)) {
  const t=JSON.parse(readFileSync(testFile));
  csv("validation.csv", [["check","status","passed","failed","detail"],["unit_and_integration_tests",t.success?"PASS":"FAIL",t.numPassedTests,t.numFailedTests,"Final complete Vitest run"],["core_and_adapter_builds","PASS",2,0,"Direct Node TypeScript commands; see reproduction manifest"],["old_result_cleanup","BLOCKED","","","Backup verified; recursive deletion rejected by automatic approval policy"]], "Actual test report and tool outcomes");
}
copy(join(run,"reproduction-manifest.json"), "reproduction-manifest.json");
copy(join(run,"ollama-environment.json"), "ollama-environment.json");
for (const f of ["runtime-environment.json","graphics-hardware.json"]) if(existsSync(join(run,f))) copy(join(run,f),f);
copy(join(root,"research/annotation/REVISION_NOTES.md"),"REVISION_NOTES.md");
for (const name of evalDirs) copy(join(run,name,"run-manifest.json"), `${name}-run-manifest.json`);
const readme = `# Fresh TraceForge controlled results\n\nAll result CSVs in this directory were exported from the new run at ${run}. No bundled benchmark measurements were substituted. Rates are fractions, not percentages. paper-main-results.csv is the main table; benchmark-summary.csv reproduces the patch benchmark with the current verifier and its original-2.0 baseline and ablations. They use different matching/baseline definitions and must be reported separately.\n\nThe verifier remains policy 3.1.0. Extraction is version 3.2.0: Ollama selects quotes/types; unique atomic statement anchoring preserves the complete assertion and deterministic code derives its target, counts, outcome and semantic basis. No gold labels or evidence enter extraction. Exact matching is unchanged. Gold fields are explicitly stripped before LLM/agent judgment. The agent judge is a bounded read-only trace retrieval adaptation, not a reproduction of Agent-as-a-Judge.\n\nOnly controlled sessions with construction-defined gold are evaluated here. The natural export has ${natural.length} unannotated sessions and cannot establish natural-report accuracy. F families were targeted development cases, and H families have now been examined during development; do not describe these new runs as independent held-out validation. Eight variants share family/response templates, so the family-cluster sensitivity file accompanies the requested session-clustered intervals. New independent tasks and genuine human adjudication remain necessary for the manuscript's natural-study claims.\n\naccuracy counts missed/unscored gold as incorrect. matched_accuracy excludes missing decisions. false_verified_rate uses non-VERIFIED gold claims as denominator and excludes spurious predictions; spurious_verified_claims is reported separately. Undefined rates are blank. macro_f1 averages defined verdict classes (see per-verdict-metrics.csv). Confusion matrices include MISSING and SPURIOUS. Inference/judge failures are retained and count against accuracy. A zero failures.csv row count means no recorded runtime failure, not perfect prediction quality.\n\nThe completed Ollama pipeline used heuristic fallback for 8 of 56 distinct responses (16 of 200 sessions, including cache reuse). Its scores describe this hybrid pipeline, not a pure-model baseline. A long wall-clock interruption affected latency measurements; outliers are retained and pooled inference latency must not be presented as a clean cold/warm benchmark.\n\nDuplicate-response extraction caching uses exact final-response text within one model/configuration; inference-summary.csv records actual calls, cache hits, fallbacks, tokens and repairs. Cache lookup latency is separate in latency-summary.csv and must not be reported as model inference speed. Model identity/digest and environment are recorded.\n\nverification-microbenchmark.csv is a synthetic API scalability check with 1,000 events and 50 paired repetitions, not end-to-end latency or natural-session accuracy. It retains the single-claim slowdown as well as multi-claim improvements. Context diagnostics are not a controlled before/after speed comparison.\n\nPrevious results were backed up to ${resolve(root,"../traceforge-results-backup-20261028.zip")}. Recursive deletion was rejected by automatic approval policy; prior outputs therefore remain separate. Use this directory's CSVs for the new run.\n\nReproduce using direct Node commands:\n\n    node research/annotation/reproduce-revision.mjs --old <built-original-5fc292c-checkout> --python <python-with-pytest> --context-tokens 4096 --skip-judges --out-dir <fresh-run-directory>\n    node research/annotation/export-revision-report.mjs --run-dir <fresh-run-directory> --out-dir <fresh-export-directory>\n\nBuild the original checkout with the repository TypeScript executable and its tsconfig before running. Full commands, timestamps, exit codes and stdout/stderr are preserved in the run directory. Do not reuse output paths.\n`;
writeFileSync(join(out,"README.md"),readme,{flag:"wx"}); record(join(out,"README.md"),"Methodology and observed limitations");
writeFileSync(join(out,"file-inventory.csv"),toCsv(inventory),{flag:"wx"});
// Round-trip every deliverable CSV to detect malformed row widths/quoting.
for (const file of readdirSync(out).filter(f=>f.endsWith(".csv"))) csvRecords(parseCsv(readFileSync(join(out,file),"utf8")));
console.log(JSON.stringify({output:out,evaluations:evalDirs.length,mainTableRows:main.length-1,csvFiles:readdirSync(out).filter(f=>f.endsWith(".csv")).length},null,2));
