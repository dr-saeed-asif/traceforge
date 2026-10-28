# Revision reproduction notes

The supplied six-part review patch applies cleanly to original revision
`5fc292cf47038e3831c7e6ef936fc095ca7e8383` in the isolated reference directory.
Its features already exist in the working checkout alongside later changes.
The current verifier is policy 3.1.0; reverting it to the patch's 2.1.0 files
would discard subsequent fixes. The exported patch audit compares final files
with the clean patch reference.

## Changes in this revision

- Extraction version 3.2.0 asks Ollama for exact source quotes and claim types.
  Code derives targets, explicit counts, expected outcomes and semantic basis.
- An unambiguous partial quote is anchored to its full atomic statement in the
  same response. Ambiguous fragments are not expanded. This preserves assertion
  context without changing exact evaluation matching or consulting gold labels.
- Recognized literal operations, such as "All 13 tests passed", use the local
  operation policy. The model cannot arbitrarily turn them into behavioral
  claims. Local checks still classify hedged and semantic claims as unverifiable.
- Batch verification prepares the prompt's sorted, claim-time evidence once.
  Independent public calls remain supported; regression tests compare their
  decisions with batch calls on unordered and post-response evidence.
- Oracle claim objects are converted to an explicit public-field allowlist
  before LLM or agent judging. Gold verdicts, rationale, annotation metadata and
  gold evidence pointers are excluded.
- Evaluation optionally caches extraction by exact response text within one
  model/configuration. Each session is still verified against its own trace.
  Cache timing and actual inference timing are reported separately.
- Requested model context is configurable and recorded. The initial 8K attempt
  was interrupted after observing repeated backend restarts while the provider
  reported 4K. A fresh 4K output directory retains all results from that retry.
  Diagnostic timings do not establish a controlled speed improvement.

## Interpretation

The new run directory contains executed controlled scenarios with gold known by
construction. These are not human-adjudicated natural sessions. The previously
designated H families have now been examined during development, so the new
report calls them stress cases rather than claiming an independent holdout.
Both session- and family-clustered bootstrap intervals are exported to expose
the effect of repeated response templates.

The natural dataset remains unannotated. Natural-session judge comparisons,
human agreement and natural accuracy await independent annotation and genuine
adjudication. The existing eight-type protocol's treatment of OTHER claims also
needs resolution before claiming complete extraction coverage.

The earlier outputs have a verified backup outside the repository. Automatic
approval review blocked recursive deletion; old folders therefore remain. New
CSV exports read only the new run's files and include provenance hashes.

## Reproduce

Use direct Node commands from the repository root. Provide a built original
checkout and Python with pytest. Every new run/export needs a fresh directory.

```powershell
node research/annotation/reproduce-revision.mjs --old <original-checkout> --python <python-with-pytest> --context-tokens 4096 --skip-judges --out-dir <fresh-run>
node research/annotation/export-revision-report.mjs --run-dir <fresh-run> --out-dir <fresh-CSV-directory>
```

`--resume-dir` reuses completed stages, preserves earlier command attempts, and
writes a failed evaluation's retry to a different directory. Omit
`--skip-judges` only to run additional controlled judge baselines; this does not
satisfy the pending natural-session study.
