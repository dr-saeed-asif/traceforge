#!/usr/bin/env node
/**
 * Baseline B1: an LLM judge given the same prompt-scoped trace and claim.
 * NOT RUN in the review environment (no model endpoint). Run it on the
 * benchmark sessions and on the annotated natural-session export.
 *
 * Usage:
 *   node research/benchmark/llm-judge.mjs --sessions research/benchmark/results/sessions.jsonl \
 *     --endpoint http://127.0.0.1:11434/api/chat --model qwen3:14b --out research/benchmark/results/llm-judge.jsonl
 * Any Ollama-compatible /api/chat endpoint works. Temperature 0, fixed seed.
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
const sessions = readFileSync(args.sessions, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const VERDICTS = ["VERIFIED", "CONTRADICTED", "UNSUPPORTED", "UNVERIFIABLE"];
const SYSTEM = `You audit a coding agent's completion claim against its execution trace.
Return JSON {"verdict": one of ${VERDICTS.join(", ")}, "evidenceEventIds": [..], "reason": "..."}.
VERIFIED: the trace shows the claim held at claim time for the final state.
CONTRADICTED: the trace shows the opposite outcome.
UNSUPPORTED: not established, or only stale evidence (a later file change after the passing run).
UNVERIFIABLE: hedged or behavioural claims with no objective check.`;

const rows = [];
if (!args.sessions || !args.endpoint || !args.model || !args.out) throw new Error("Provide --sessions, --endpoint, --model and --out");
for (const session of sessions) {
  const trace = session.evidence; // Identical prompt-scoped trace; no gold labels.
  for (const claim of session.gold) {
    const started = Date.now();
    let predicted = "ERROR", reason = null, evidenceEventIds = [], usage = null, error = null;
    try {
      const response = await fetch(args.endpoint, {
        method: "POST", signal: AbortSignal.timeout(180_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: args.model, stream: false, format: "json", options: { temperature: 0, seed: 42 },
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `CLAIM: ${claim.quote}\nTRACE:\n${JSON.stringify(trace)}` }] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      usage = { inputTokens: body.prompt_eval_count ?? null, outputTokens: body.eval_count ?? null };
      const parsed = JSON.parse(body.message?.content ?? "{}");
      if (!VERDICTS.includes(parsed.verdict) || !Array.isArray(parsed.evidenceEventIds) ||
          parsed.evidenceEventIds.some(id => !trace.some(event => event.eventId === id))) throw new Error("Invalid judge output");
      predicted = parsed.verdict; reason = parsed.reason ?? null; evidenceEventIds = parsed.evidenceEventIds;
    } catch (failure) { error = failure.message; }
    rows.push({ system: `B1 LLM judge (${args.model})`, session: session.id, family: session.family, gold: claim.verdict,
      predicted, reason, evidenceEventIds, usage, error, latencyMs: Date.now() - started });
  }
}
writeFileSync(args.out, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { flag: "wx" });
const accuracy = rows.filter((r) => r.predicted === r.gold).length / rows.length;
const notV = rows.filter((r) => r.gold !== "VERIFIED");
console.log(`n=${rows.length} accuracy=${(100 * accuracy).toFixed(1)}% falseVerified=${(100 * notV.filter((r) => r.predicted === "VERIFIED").length / notV.length).toFixed(1)}%`);
