# Frozen round-3 robustness acceptance

This imports the authors' 31-file `final-r3/robustness` bundle. Original file
hashes and the existing policy 3.1.0 / extraction 3.2.0 runtime are recorded in
`baseline-manifest.json`. Source, evidence, labels and reference results are
not modified. Scripts only gain an explicit prediction-directory parameter.
The missing prediction files are regenerated into **fresh** experiment folders.
Source fingerprints normalize CRLF/LF to survive Git text conversion across
platforms; frozen JSONL evidence and reference results remain byte-exact under
the supplied `.gitattributes` rules.

The Table 10 base is the supplied `phrasing/phrasing-P0.jsonl`, not a newly
executed benchmark. The existing Windows export differs in 136 evidence records
and 16 metadata objects; both remain frozen. Using its different traces and
claiming byte-identical reproduction of the author's bundle would be incorrect.

From the repository root, after dependency installation:

```powershell
node research/robustness/scripts/reproduce-table10.mjs --check-only
node research/robustness/scripts/reproduce-table10.mjs --python python --out-dir <new-directory>
```

Node invokes TypeScript and evaluation directly, avoiding npm argument
forwarding. Python uses only its standard library. No model endpoint, private
key, chain deployment or old checkout is required. Paths are explicit and
spaces are supported. An existing output directory is rejected. A later change
to a pinned runtime file is rejected: run the baseline from its frozen checkout
and evaluate policy 3.2.0 / extraction 3.3.0 as separate experiments.

## Acceptance evidence and alignment

- `acceptance-checks.csv` compares recomputed counts, gate outcomes, matching
  controls and confidence intervals with the author references. It also checks
  threshold invariance at the six specified thresholds. A mismatch fails the
  run; reference values never replace calculated results.
- `phrasing-summary.csv` and `author-phrasing-ci.stdout.log` reproduce the
  manuscript's **supplementary containment/Dice** coverage analysis. Its
  containment-first split-claim combination and Dice threshold 0.5 are retained.
- `table10-reproduced.csv` consolidates the manuscript rows. The original-style
  interval is from the main seed-42 evaluator (88.8–95.9%); the supplied Python
  seed-7 script instead gives 89.0–96.2%. Passive-style paper intervals use that
  Python script. Both are retained with provenance rather than choosing a seed
  to fit a result. Baseline-equivalent intervals for filler/narrative/bullets
  are used only after checking identical per-session counts.
- `main-exact-statistics.csv` uses the existing normalized exact one-to-one
  source-span matching. Type correctness is a separate metric. Its detected
  counts are not interchangeable with containment coverage.
- `phrasing-coverage-statistics.csv`, `phrasing-coverage-per-claim.csv`,
  `alignment-comparison.csv` and `threshold-sensitivity.csv` explicitly identify
  the supplementary estimand; do not call its coverage extraction P/R/F1.
- Each experiment retains raw predictions, failures, metrics, per-claim CSVs,
  source hashes, commands, commit/environment/exit provenance and a Table 10
  README. The root hash inventory covers these outputs.

## Statistical contract

Supplementary statistics do not alter the frozen evaluator. Run identity
includes policy, extraction version, dataset hash, alignment, extractor,
baseline, model and **model seed**. Model/seed/version groups are not pooled.
The bootstrap seed is a separate field. Session and family intervals resample
whole units, with 2,000 repetitions and supplementary seed 7. The author paper
intervals retain their original RNG/quantile conventions and are checked
separately, not overwritten by this supplementary method.

Clopper-Pearson bounds are two-sided equal-tailed 95% iid-binomial intervals.
For zero events out of 96 eligible claims the upper bound is about 3.77%, not
zero; zero eligible observations produce unavailable bounds, not a zero rate.
Claims within families and repeated model seeds are correlated, so these bounds
are explicitly supplementary and do not replace clustered intervals. Runtime
failures remain unscored/incorrect gold outcomes in accuracy, and cannot be
silently dropped. No monetary cost is inferred from local-model token counts.

## Capture acceptance

`CAPTURE-ACCEPTANCE.md` resolves the threat boundary, missing-tail detection,
hook-disable test, invalid-session behavior and reason-code mapping. It is a
design contract for E4. **The experimental Linux profile 3.2.0-capture.1 is now
implemented and locally deployed**, with separate UIDs, protected dispatch and
signed completion seals. See `infrastructure/protected-capture/README.md` and
`research/exports/protected-capture-20261029/`. The legacy Windows outbox and
live OpenCode integration remain unprotected; authenticated replay is not a
live-agent evaluation.

The frozen replay itself does not rotate keys, rewrite Git history, publish a
release or deploy contracts. New matching/extraction versions are additional
experiments under `research/revision-r1/`; keep their rows separate. Remote
trace retention and external publication cannot be inferred from local files.
