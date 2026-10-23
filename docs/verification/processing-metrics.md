# Processing status and latency

The query popup polls active sessions every three seconds without collapsing
expanded claims. The session list refreshes every five seconds; active session
detail pages refresh every three seconds. Active status badges display a spinner,
and elapsed times update every second. Closing the popup aborts its requests.

Execution is marked complete before waiting for extraction. Extraction and
verification use `PENDING` while processing, followed by `SUCCEEDED` or `FAILED`.
Claims are described as waiting while extraction has not finished.

New processing attempts persist optional `processingMetrics` on the session:

- The actual configured extraction model, separate from the coding-agent model.
- Extraction and verification start/end timestamps.
- Extractor call duration, including local model loading and any repair request.
- Extraction duration, including saving claims.
- Verification duration, including loading evidence and saving verdicts.

Durations use a monotonic clock and are stored in milliseconds, including failed
attempts. Execution elapsed uses captured prompt and completion timestamps. Time
to first tool uses the first captured command-start or tool-associated event;
it does not measure the provider's time to first token. Running timers in the UI
are approximate wall-clock values until recorded durations arrive.

Infrastructure readiness checks service connectivity. OpenCode still needs to
execute the task and deliver its final response before claim extraction starts.
An available Ollama service may still need to load the configured model.
Verification uses deterministic rules and does not call an LLM.

SQLite migration `002_processing_metrics.sql` adds a nullable metrics column.
Restart the API with `npm run api:start` to build the code and apply pending
migrations automatically. Historical timings are not backfilled; the UI can
recover the historical extraction model from stored claims when available.
