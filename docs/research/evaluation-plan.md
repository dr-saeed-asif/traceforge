# Research evaluation plan

TraceForge evaluates coverage and overhead without equating event volume with complete provenance.

## Completeness

The evaluation package scores eleven categories: prompt, agent, model, tool, resource, file, command, artifact, test, approval, and Git. A category contributes to the numerator only when at least one event is explicitly `OBSERVED`. Categories declared `NOT_OBSERVED` or `NOT_AVAILABLE` are reported but excluded from the observable denominator. Unknown categories remain in the denominator so missing instrumentation is visible rather than rewarded.

Report category statuses next to the aggregate score. Never publish the score alone or describe it as proof that all activity was captured.

## Experiments

For each adapter and workload, compare an uninstrumented baseline with TraceForge enabled. Record at least 30 warmed runs and report median, p95, dispersion, workload size, Node version, hardware, database mode, artifact size, and adapter capability declaration.

Measure capture and provider latency; canonicalization, hashing, encryption, and verification duration; events per second and queue saturation; CPU and peak memory; metadata and artifact bytes per run; tamper detection; and observed, unavailable, and unknown categories per provider.

`@traceforge/evaluation` supplies a deterministic completeness evaluator and an operation-measurement primitive. Environment-level CPU, storage, and database measurements belong in a reproducible benchmark harness rather than production request handlers.
