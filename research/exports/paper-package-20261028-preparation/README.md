# TraceForge paper CSV package

Generated from existing repository evidence. No human labels or natural-study accuracy were invented. All rates are fractions (multiply by 100 for percentages). See file-inventory.csv for provenance and SHA-256.

## Human annotation

Give human-annotation/natural-v1.annotator-a.csv only to annotator A and the B file only to annotator B, plus human-annotation/INSTRUCTIONS.md. Both label independently. Give the adjudication template to the adjudicator after both finish. Every session must be reviewed, including genuinely claim-free responses. Keep original independent files. No predicted claims or verdicts are included in these worksheets.

## Results boundaries

Tables 6-9 are existing controlled benchmark measurements, Table 10 is pilot screenshot data, and Table 11 transcribes the attached manuscript's single-run observation. Existing-evaluations exports current-policy controlled runs separately: they are not replacements for the historical policy 2.0/2.1 tables. Natural evaluation status is NOT_RUN. Public-network receipts and human agreement remain unavailable.

The current export has 40 sessions, two recorded agent models and zero independently labelled gold claims. It falls below the manuscript target of 150 sessions and three models. Language and runner coverage require collection metadata. Some prompts prescribe the exact final answer, so authors must review sampling before calling this a representative natural-report corpus.

## Commands after genuine annotation

Run from the repository root, using Node directly.

```powershell
node research/annotation/build-adjudicated-dataset.mjs --annotations "E:\PhD Data\latest_plugin\traceforge\research\exports\paper-package-20261028-preparation\human-annotation\natural-v1.adjudications.csv" --dry-run
node research/annotation/build-adjudicated-dataset.mjs --annotations "E:\PhD Data\latest_plugin\traceforge\research\exports\paper-package-20261028-preparation\human-annotation\natural-v1.adjudications.csv"
node research/annotation/run-evaluation-suite.mjs --model qwen3:4b
node research/annotation/export-evaluation-suite.mjs --run-dir "<new suite directory>" --dataset research/datasets/natural-v1-adjudicated.jsonl --out-dir "<fresh export directory>"
```

The converter validates structure, quotes, evidence membership and completion markers; humans remain responsible for semantic correctness, claim coverage and provenance. It cannot prove that entered labels came from independent humans. The eight-type evaluator does not support OTHER: retain such claims in notes, report excluded counts and resolve this protocol limitation before claiming full natural-report extraction coverage. A claim missed by one annotator needs explicit human reconciliation; never fabricate that annotator's verdict to satisfy the current converter.
