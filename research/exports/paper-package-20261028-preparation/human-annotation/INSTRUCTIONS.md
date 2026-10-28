# Natural-v1 annotation and adjudication

The current `research/datasets/natural-v1.jsonl` export is **unannotated**:
40 sessions, 40 blank rows in `natural-v1.annotations.csv`, and zero gold
claims. The files in this directory prepare the human study; they do not create
labels and must not be used to imply that the study is complete.

## 1. Independent annotation

Generate two separate, prediction-blind worksheets:

```powershell
node research/annotation/prepare-worksheets.mjs
```

This writes `research/datasets/natural-v1.annotator-a.csv` and
`natural-v1.annotator-b.csv`. Each contains only the session ID, prompt, final
response, full evidence references and blank annotation fields. It does not read
`natural-v1.claims.csv` and does not contain TraceForge extracted claims or
verdicts. Give one file to each annotator; do not show them each other's file or
the system predictions.

For every asserted factual claim, fill:

- `claim_id` — unique within the session, e.g. `C1`.
- `source_quote` — an exact substring of the final response (no paraphrase).
- `claim_type` — one of `FILE_CREATED`, `FILE_MODIFIED`, `STRUCTURE_CREATED`,
  `DEPENDENCY_RULE`, `COMMAND_SUCCEEDED`, `BUILD_PASSED`, `TEST_PASSED`,
  `TASK_COMPLETED`. `OTHER` is not scorable by the evaluator; record it in
  `rationale`/`notes` and leave the claim out of the machine-readable label.
- `target` — the file path, command, or object named by the claim.
- `expected_result` — optional; if blank, the converter derives the standard
  expectation for the claim type.
- `annotator_verdict` — `VERIFIED`, `CONTRADICTED`, `UNSUPPORTED`, or
  `UNVERIFIABLE`, following `research/benchmark/ANNOTATION.md`.
- `rationale`, `evidence_event_ids` (JSON array or semicolon-separated event
  IDs from the supplied evidence), `test_tampering` (`TRUE`/`FALSE`), and
  `capture_completeness` (`COMPLETE`, `INCOMPLETE`, or `NOT_AVAILABLE`).
- `annotation_status` — `COMPLETE` for a claim row. If the response genuinely
  contains no claims, set exactly one row to `NO_CLAIMS`, leave the claim fields
  blank, and set `annotator_verdict=NO_CLAIMS`.

Ten claim slots are preallocated per session. Insert additional rows if a
session has more than ten claims, copying the session context. Do not delete
the context columns.

## 2. Adjudication

A third person independently adjudicates every claim using both completed
worksheets. Create `research/datasets/natural-v1.adjudications.csv` with the
columns in `research/annotation/adjudication-template.csv`. Every included row
must contain both raw annotator verdicts, the adjudicated verdict, rationale,
adjudicator ID, timestamp, and `adjudication_status=ADJUDICATED`.

- Claim rows use `session_status=CLAIMS_PRESENT`.
- A genuinely claim-free session uses one row with
  `session_status=NO_CLAIMS`, all three verdict fields set to `NO_CLAIMS`, and
  blank claim fields.
- Every session in `natural-v1.jsonl` must appear. Missing sessions, blank
  verdicts, non-exact quotes, unknown evidence IDs, and non-adjudicated rows are
  rejected.

Do **not** copy values from `natural-v1.claims.csv` (the system predictions)
into the adjudication file. That would invalidate the study.

## 3. Build the adjudicated dataset

```powershell
node research/annotation/build-adjudicated-dataset.mjs --dry-run
node research/annotation/build-adjudicated-dataset.mjs
```

The default input is `research/datasets/natural-v1.adjudications.csv`; the output
is `research/datasets/natural-v1-adjudicated.jsonl`. The script preserves the
original evidence array, validates every claim and evidence reference, rejects
incomplete adjudication, and writes with `wx` so an existing frozen dataset is
never overwritten. `--force` is available only for an explicitly reviewed
rebuild.

## 4. Run the paper evaluations

Only after the adjudicated dataset exists and has been frozen:

```powershell
node research/annotation/run-evaluation-suite.mjs
```

The runner builds with direct Node, overrides the default model to `qwen3:4b`,
and creates a fresh `research/runs/natural-v1-<timestamp>-<id>/` directory with
separate subdirectories for:

1. oracle + heuristic extraction with deterministic, accept-all and regex
   baselines;
2. Ollama extraction with deterministic verification;
3. the LLM judge baseline;
4. the bounded read-only agent judge baseline.

Each evaluation gets its own output directory and log. `suite-manifest.json`
records the commands, exits, dataset hash and model. Use `--dry-run` to print
the exact direct-Node commands without running them.

The current checkout has no genuine adjudicated labels, so these paper
evaluations have not been run.
