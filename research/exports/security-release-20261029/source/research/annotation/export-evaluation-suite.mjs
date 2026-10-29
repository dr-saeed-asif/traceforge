#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseArgs, readJsonl, toCsv, sha256 } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const root = resolve(import.meta.dirname, "../..");
const runDir = resolve(args["run-dir"] ?? resolve(root, "research/runs"));
const datasetPath = resolve(args.dataset ?? resolve(root, "research/datasets/controlled-v1.jsonl"));
const outDir = resolve(args["out-dir"] ?? resolve(root, "research/exports/evaluation"));
const force = args.force === true;

if (!existsSync(datasetPath)) throw new Error(`Missing dataset: ${datasetPath}`);
if (!existsSync(runDir)) throw new Error(`Missing run directory: ${runDir}`);
if (!force && existsSync(outDir)) throw new Error(`Refusing to overwrite ${outDir}; use --force after review.`);
mkdirSync(outDir, { recursive: true });

const dataset = readJsonl(datasetPath);
const familyById = new Map();
const goldById = new Map(dataset.map(session => [session.id, session.goldClaims ?? []]));
for (const session of dataset) {
  if (session.id && session.metadata?.family) familyById.set(session.id, session.metadata.family);
}

function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = p / 100 * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}
function median(values) { return percentile(values, 50); }
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function minmax(values) { return values.length ? [Math.min(...values), Math.max(...values)] : [null, null]; }
const n2 = (x) => x == null ? "" : Number(x.toFixed ? x.toFixed(6) : x);
const pct = (x) => x == null ? "" : (x * 100).toFixed(2);

const evaluationDirs = [];
const entries = readdirSync(runDir, { withFileTypes: true });
for (const entry of entries) {
  const full = resolve(runDir, entry.name);
  if (!entry.isDirectory()) continue;
  if (existsSync(resolve(full, "metrics.json"))) evaluationDirs.push(full);
}
if (!evaluationDirs.length && existsSync(resolve(runDir, "metrics.json"))) evaluationDirs.push(runDir);
if (!evaluationDirs.length) throw new Error(`No evaluation directories with metrics.json under ${runDir}`);

const systemRows = [["eval_name", "extractor", "baseline", "sessions", "gold_claims", "missed_claims", "spurious_claims", "accuracy", "clusters", "ci_lower", "ci_upper", "ci_valid_replicates", "macro_f1_defined_verdicts", "matched_verdict_accuracy", "false_verified_gold_claims", "non_verified_gold_claims", "false_verified_rate", "spurious_verified_claims"]];
const verdictRows = [["eval_name", "extractor", "baseline", "verdict", "support", "true_positive", "false_positive", "false_negative", "precision", "recall", "f1", "precision_ci_lower", "precision_ci_upper", "recall_ci_lower", "recall_ci_upper", "f1_ci_lower", "f1_ci_upper"]];
const claimRows = [["eval_name", "extractor", "baseline", "pair_index", "session_id", "family", "gold_claim_index", "gold_source_quote", "gold_benchmark_quote", "gold_claim_type", "gold_target", "gold_expected_result", "gold_verdict", "predicted_claim_index", "predicted_source_quote", "predicted_claim_type", "predicted_target", "predicted_verdict", "correct", "extraction_error", "decision_reason", "evidence_event_ids"]];
const extractionRows = [["eval_name", "extractor", "sessions", "gold_claims", "predicted_claims", "matched_claims", "type_correct", "failed", "successful_empty", "precision", "recall", "f1"]];
const latencyRows = [["eval_name", "extractor", "baseline", "stage", "count", "min_ms", "max_ms", "mean_ms", "median_ms", "error_count"]];
const failureRows = [["eval_name", "session_id", "extractor", "baseline", "claim_index", "error"]];
const confusionRows = [["eval_name", "extractor", "baseline", "expected", "actual", "count"]];
const provenanceRows = [["eval_name", "dataset", "dataset_hash", "policy_version", "judge_model", "matching", "bootstrap", "allow_unadjudicated", "recorded_failures", "manifest_source"]];
const inferenceRows = [["eval_name", "extractor", "inference_sessions", "cached_sessions", "fallback_sessions", "failed_sessions", "model_attempts", "repair_attempts", "input_tokens", "output_tokens"]];

for (const evalDir of evaluationDirs) {
  const evalName = basename(evalDir);
  const manifestPath = resolve(evalDir, "run-manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  if (manifest.datasetHash && manifest.datasetHash !== sha256(readFileSync(datasetPath))) {
    throw new Error(`Dataset hash does not match frozen evaluation: ${evalDir}`);
  }
  provenanceRows.push([evalName, manifest.dataset ?? datasetPath, manifest.datasetHash ?? "", manifest.policyVersion ?? "", manifest.judgeModel ?? "", manifest.matching ?? "", manifest.bootstrap ?? "", manifest.allowUnadjudicated ?? "", manifest.failures ?? "", manifestPath]);
  const metrics = JSON.parse(readFileSync(resolve(evalDir, "metrics.json"), "utf8"));
  const predictions = existsSync(resolve(evalDir, "predictions.jsonl")) ? readJsonl(resolve(evalDir, "predictions.jsonl")) : [];
  const extractions = existsSync(resolve(evalDir, "extraction.jsonl")) ? readJsonl(resolve(evalDir, "extraction.jsonl")) : [];
  const latencies = existsSync(resolve(evalDir, "latencies.jsonl")) ? readJsonl(resolve(evalDir, "latencies.jsonl")) : [];
  const failures = existsSync(resolve(evalDir, "failures.jsonl")) ? readJsonl(resolve(evalDir, "failures.jsonl")) : [];

  for (const [key, metric] of Object.entries(metrics)) {
    const [extractor, baseline] = key.split("/");
    const ci = metric.confidenceIntervals?.accuracy ?? {};
    for (const [pair, count] of Object.entries(metric.confusion ?? {})) {
      const [expected, actual] = pair.split("->");
      confusionRows.push([evalName, extractor, baseline, expected, actual, count]);
    }
    const confusion = Object.entries(metric.confusion ?? {}).map(([pair, count]) => ({ expected: pair.split("->")[0], actual: pair.split("->")[1], count }));
    const total = items => items.reduce((sum, item) => sum + item.count, 0);
    const matched = confusion.filter(p => p.expected !== "SPURIOUS" && p.actual !== "MISSING");
    const negative = confusion.filter(p => p.expected !== "VERIFIED" && p.expected !== "SPURIOUS");
    const falseVerified = total(negative.filter(p => p.actual === "VERIFIED"));
    const f1s = Object.values(metric.perVerdict ?? {}).map(v => v.f1).filter(v => typeof v === "number");
    systemRows.push([evalName, extractor, baseline, manifest.datasetSessions ?? metric.clusters ?? "", metric.goldClaims ?? "", metric.missedClaims ?? "", metric.spuriousClaims ?? "", n2(metric.accuracy), metric.clusters ?? "", n2(ci.lower), n2(ci.upper), ci.validReplicates ?? "", n2(mean(f1s)), total(matched) ? n2(total(matched.filter(p => p.expected === p.actual)) / total(matched)) : "", falseVerified, total(negative), total(negative) ? n2(falseVerified / total(negative)) : "", total(confusion.filter(p => p.expected === "SPURIOUS" && p.actual === "VERIFIED"))]);
    for (const verdict of Object.keys(metric.perVerdict ?? {})) {
      const v = metric.perVerdict[verdict];
      const intervals = metric.confidenceIntervals?.perVerdict?.[verdict];
      verdictRows.push([evalName, extractor, baseline, verdict, v.support ?? "", v.truePositive ?? "", v.falsePositive ?? "", v.falseNegative ?? "", n2(v.precision), n2(v.recall), n2(v.f1), n2(intervals?.precision?.lower), n2(intervals?.precision?.upper), n2(intervals?.recall?.lower), n2(intervals?.recall?.upper), n2(intervals?.f1?.lower), n2(intervals?.f1?.upper)]);
    }
  }

  for (const item of predictions) {
    const family = familyById.get(item.id) ?? "";
    const extractor = item.extractor ?? "";
    const baseline = item.baseline ?? "";
    const extractionError = item.extractionError ?? "";
    const claims = item.claims ?? [];
    const decisions = item.decisions ?? [];
    const decisionByIndex = new Map();
    for (const [index, decision] of decisions.entries()) decisionByIndex.set(index, decision);
    const alignment = item.alignment ?? [];
    const predictedByIndex = new Map(claims.map((c, i) => [i, c]));
    const alignedGold = new Set(alignment.map((a) => a.goldIndex).filter((x) => x != null));
    const alignedPred = new Set(alignment.map((a) => a.predictedIndex).filter((x) => x != null));
    let pairIndex = 0;
    for (const pair of alignment) {
      const goldIndex = pair.goldIndex;
      const predIndex = pair.predictedIndex;
      const gold = goldIndex != null ? (goldById.get(item.id)?.[goldIndex] ?? {}) : {};
      const predicted = predIndex != null ? predictedByIndex.get(predIndex) ?? {} : {};
      const goldVerdict = gold.verdict ?? null;
      const predVerdict = (predIndex != null ? decisionByIndex.get(predIndex)?.verdict ?? null : null);
      const correct = goldVerdict != null && predVerdict != null ? goldVerdict === predVerdict : null;
      claimRows.push([evalName, extractor, baseline, pairIndex++, item.id, family, gold.claimIndex ?? "", gold.claimText ?? "", gold.benchmarkQuote ?? "", gold.claimType ?? "", gold.target ?? "", gold.expectedResult ?? "", goldVerdict ?? "", predicted.claimIndex ?? "", predicted.sourceQuote ?? predicted.claimText ?? "", predicted.claimType ?? "", predicted.target ?? "", predVerdict ?? "", correct ?? "", extractionError, JSON.stringify(decisionByIndex.get(predIndex ?? -1)?.reason ?? ""), (gold.evidenceEventIds ?? []).join(";")]);
    }
    for (const [i, gold] of (goldById.get(item.id) ?? []).entries()) {
      if (!alignedGold.has(i)) {
        claimRows.push([evalName, extractor, baseline, pairIndex++, item.id, family, gold.claimIndex ?? i + 1, gold.claimText ?? "", gold.benchmarkQuote ?? "", gold.claimType ?? "", gold.target ?? "", gold.expectedResult ?? "", gold.verdict ?? "", "", "", "", "", null, null, extractionError, "", (gold.evidenceEventIds ?? []).join(";")]);
      }
    }
    for (const [i, predicted] of claims.entries()) {
      if (!alignedPred.has(i)) {
        const decision = decisionByIndex.get(i);
        claimRows.push([evalName, extractor, baseline, pairIndex++, item.id, family, "", "", "", "", "", "", "", predicted.claimIndex ?? i + 1, predicted.sourceQuote ?? predicted.claimText ?? "", predicted.claimType ?? "", predicted.target ?? "", decision?.verdict ?? null, null, extractionError, JSON.stringify(decision?.reason ?? ""), ""]);
      }
    }
  }

  for (const extractor of new Set(extractions.map(item => item.extractor))) {
    const items = extractions.filter(item => item.extractor === extractor);
    const sum = key => items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
    extractionRows.push([evalName, extractor, items.length, sum("gold"), sum("predicted"), sum("matched"), sum("typeCorrect"), sum("failed"), sum("successfulEmpty"), sum("predicted") ? n2(sum("matched") / sum("predicted")) : "", sum("gold") ? n2(sum("matched") / sum("gold")) : "", sum("predicted") + sum("gold") ? n2(2 * sum("matched") / (sum("predicted") + sum("gold"))) : ""]);
  }

  const byStageBaseline = new Map();
  for (const extractor of new Set(latencies.filter(l => l.stage === "extraction").map(l => l.extractor))) {
    const items = latencies.filter(l => l.stage === "extraction" && l.extractor === extractor);
    const actual = items.filter(l => !l.metadata?.cacheHit);
    const sum = fn => actual.reduce((n, l) => n + Number(fn(l) ?? 0), 0);
    inferenceRows.push([evalName, extractor, actual.length, items.length - actual.length, actual.filter(l => l.metadata?.outcome === "FALLBACK").length, actual.filter(l => l.error).length, sum(l => l.metadata?.attemptCount), sum(l => l.metadata?.repairCount), sum(l => l.metadata?.usage?.input_tokens), sum(l => l.metadata?.usage?.output_tokens)]);
  }
  for (const latency of latencies) {
    const stage = latency.stage === "extraction" && latency.metadata?.cacheHit ? "extraction_cache_lookup" : latency.stage;
    const key = `${latency.extractor ?? ""}|${latency.baseline ?? ""}|${stage ?? ""}`;
    const values = byStageBaseline.get(key) ?? [];
    values.push(latency.latencyMs ?? 0);
    if (latency.error) values.error = (values.error ?? 0) + 1;
    byStageBaseline.set(key, values);
  }
  for (const [key, values] of byStageBaseline) {
    const [extractor, baseline, stage] = key.split("|");
    const nums = values.filter((v) => typeof v === "number");
    const [mn, mx] = minmax(nums);
    latencyRows.push([evalName, extractor, baseline, stage, nums.length, n2(mn), n2(mx), n2(mean(nums)), n2(median(nums)), values.error ?? ""]);
  }

  for (const failure of failures) {
    failureRows.push([evalName, failure.id ?? "", failure.extractor ?? "", failure.baseline ?? "", failure.claimIndex ?? "", failure.error ?? ""]);
  }

}

writeFileSync(resolve(outDir, "system-metrics.csv"), toCsv(systemRows), "utf8");
writeFileSync(resolve(outDir, "per-verdict-metrics.csv"), toCsv(verdictRows), "utf8");
writeFileSync(resolve(outDir, "per-claim.csv"), toCsv(claimRows), "utf8");
writeFileSync(resolve(outDir, "extraction-summary.csv"), toCsv(extractionRows), "utf8");
writeFileSync(resolve(outDir, "latency-summary.csv"), toCsv(latencyRows), "utf8");
writeFileSync(resolve(outDir, "failures.csv"), toCsv(failureRows), "utf8");
writeFileSync(resolve(outDir, "confusion-matrix.csv"), toCsv(confusionRows), "utf8");
writeFileSync(resolve(outDir, "run-provenance.csv"), toCsv(provenanceRows), "utf8");
writeFileSync(resolve(outDir, "inference-summary.csv"), toCsv(inferenceRows), "utf8");

console.log(JSON.stringify({
  outDir,
  evaluationDirs: evaluationDirs.length,
  systemRows: systemRows.length - 1,
  verdictRows: verdictRows.length - 1,
  claimRows: claimRows.length - 1,
  extractionRows: extractionRows.length - 1,
  latencyRows: latencyRows.length - 1,
  failureRows: failureRows.length - 1,
}, null, 2));
