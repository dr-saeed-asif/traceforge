# Fresh TraceForge controlled results

All result CSVs in this directory were exported from the new run at E:\PhD Data\latest_plugin\traceforge\research\runs\revision-20261028-reproduced. No bundled benchmark measurements were substituted. Rates are fractions, not percentages. paper-main-results.csv is the main table; benchmark-summary.csv reproduces the patch benchmark with the current verifier and its original-2.0 baseline and ablations. They use different matching/baseline definitions and must be reported separately.

The verifier remains policy 3.1.0. Extraction is version 3.2.0: Ollama selects quotes/types; unique atomic statement anchoring preserves the complete assertion and deterministic code derives its target, counts, outcome and semantic basis. No gold labels or evidence enter extraction. Exact matching is unchanged. Gold fields are explicitly stripped before LLM/agent judgment. The agent judge is a bounded read-only trace retrieval adaptation, not a reproduction of Agent-as-a-Judge.

Only controlled sessions with construction-defined gold are evaluated here. The natural export has 40 unannotated sessions and cannot establish natural-report accuracy. F families were targeted development cases, and H families have now been examined during development; do not describe these new runs as independent held-out validation. Eight variants share family/response templates, so the family-cluster sensitivity file accompanies the requested session-clustered intervals. New independent tasks and genuine human adjudication remain necessary for the manuscript's natural-study claims.

accuracy counts missed/unscored gold as incorrect. matched_accuracy excludes missing decisions. false_verified_rate uses non-VERIFIED gold claims as denominator and excludes spurious predictions; spurious_verified_claims is reported separately. Undefined rates are blank. macro_f1 averages defined verdict classes (see per-verdict-metrics.csv). Confusion matrices include MISSING and SPURIOUS. Inference/judge failures are retained and count against accuracy. A zero failures.csv row count means no recorded runtime failure, not perfect prediction quality.

The completed Ollama pipeline used heuristic fallback for 8 of 56 distinct responses (16 of 200 sessions, including cache reuse). Its scores describe this hybrid pipeline, not a pure-model baseline. A long wall-clock interruption affected latency measurements; outliers are retained and pooled inference latency must not be presented as a clean cold/warm benchmark.

Duplicate-response extraction caching uses exact final-response text within one model/configuration; inference-summary.csv records actual calls, cache hits, fallbacks, tokens and repairs. Cache lookup latency is separate in latency-summary.csv and must not be reported as model inference speed. Model identity/digest and environment are recorded.

verification-microbenchmark.csv is a synthetic API scalability check with 1,000 events and 50 paired repetitions, not end-to-end latency or natural-session accuracy. It retains the single-claim slowdown as well as multi-claim improvements. Context diagnostics are not a controlled before/after speed comparison.

Previous results were backed up to E:\PhD Data\latest_plugin\traceforge-results-backup-20261028.zip. Recursive deletion was rejected by automatic approval policy; prior outputs therefore remain separate. Use this directory's CSVs for the new run.

Reproduce using direct Node commands:

    node research/annotation/reproduce-revision.mjs --old <built-original-5fc292c-checkout> --python <python-with-pytest> --context-tokens 4096 --skip-judges --out-dir <fresh-run-directory>
    node research/annotation/export-revision-report.mjs --run-dir <fresh-run-directory> --out-dir <fresh-export-directory>

Build the original checkout with the repository TypeScript executable and its tsconfig before running. Full commands, timestamps, exit codes and stdout/stderr are preserved in the run directory. Do not reuse output paths.
