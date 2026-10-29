# TraceForge controlled misreport benchmark (TF-CMB)

`run-controlled-benchmark.mjs` executes 25 scenario families for real in fresh
temporary workspaces (files written, `npm test`/node:test, Vitest, pytest,
`npm run build`, `node --check`, `sed -i`, `rm`, `git checkout` run), records
their real outputs and exit codes, and passes the identical history to every
system. Ground truth is known by construction because the benchmark performs
the actions itself.

**What it is:** a reproducible regression and stress benchmark for the
verifier and capture layer. **What it is not:** a sample of natural agent
sessions. It does not measure how often agents misreport, nor extractor
accuracy on real reports. Those require the annotated natural-session study
described in `ANNOTATION.md`.

## Families

- **F01–F17 (targeted).** Written *after* the round-1 review identified the
  failure modes (wrong-file matching, shell edits, compound commands, runner
  count parsing, classifier order, hedged claims, deletions, test tampering).
  Results on these families show that the identified defects are fixed; they
  are circular as a measure of general accuracy.
- **H01–H08 (held-out stress).** Written before any system was run on them,
  including cases where conservative rules are expected to cost accuracy:
  redirected test output (H03), tests that write files (H07), behavioural
  claims (H05), multi-claim reports (H06), `git checkout` reverts (H01).

Gold labels follow `ANNOTATION.md`: VERIFIED if the asserted fact held at
claim time and was observed for the final state it depends on; CONTRADICTED if
the observable outcome conflicts; UNSUPPORTED if the fact was not established
(never happened, or only stale evidence exists); UNVERIFIABLE for hedged or
behavioural assertions. F17/H08 additionally expect a test-file-edit advisory.

## Systems

| System | Claims | Capture | Verifier |
| --- | --- | --- | --- |
| B0 accept-all | oracle | — | every claim VERIFIED |
| B3 keyword log matcher | oracle | fixed | any event of the claim's category; latest failed → CONTRADICTED |
| TF 2.0.0 original | oracle / heuristic | original adapter | original verifier |
| TF 2.1.0 fixed | oracle / heuristic | fixed adapter | fixed verifier |
| Ablations | oracle | swapped | swapped |

"Oracle claims" feed the gold claim records to the verifier, isolating
verification from extraction. The original capture model reproduces the
2.0.0 adapter verbatim (no shell-side file observation, first-match count
parser). An LLM-judge baseline is provided in `llm-judge.mjs` but was **not
run** in this environment (no model endpoint available).

## Reproduce

```bash
git worktree add ../tf-old 5fc292c && (cd ../tf-old && ln -s ../tf/node_modules node_modules && npx tsc -p tsconfig.json)
npx tsc -p tsconfig.json && npx tsc -p packages/adapter-opencode/tsconfig.json
node research/benchmark/run-controlled-benchmark.mjs --new . --old ../tf-old --out research/benchmark/results --variants 8 --seed 7
```

Requires Node ≥ 22, Python 3 with pytest, and git. Outputs: `summary.json`
(metrics with session-clustered bootstrap 95% CIs), `rows.jsonl` (one row per
system × claim), `sessions.jsonl` (gold claims and the fixed-capture trace per
session), `console.txt`.

## Known limitations

- Jest is represented by a summary-format fixture (F10), not a real Jest run.
- The original-capture model re-implements the 2.0.0 adapter's capture
  functions verbatim; it does not run OpenCode.
- Each family uses one response phrasing per variant; phrasing diversity is
  far below natural reports.

Bundled `results/` files are imported from the supplied review patch and describe
its policy-2.1.0 run, not measurements from the current checkout. Use a fresh
`--out` directory for every rerun. The harness records the current policy version
in system names. On Windows it uses Git Bash when installed; `--shell` and
`--python` can select explicit executables (Python must have pytest installed).

`npm run research:benchmark -- --old <built-original-checkout>` runs both stages
into a new `.traceforge/benchmark-runs/` directory. Optional `--out`, `--variants`,
`--seed`, `--shell` and `--python` arguments are forwarded by the runner.
