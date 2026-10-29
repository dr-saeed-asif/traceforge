#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs, readJsonl, toCsv } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const datasetPath = resolve(args.dataset ?? "research/datasets/natural-v1.jsonl");
const outputDirectory = resolve(args["out-dir"] ?? dirname(datasetPath));
const claimSlots = Number(args.slots ?? 10);
const force = args.force === true;

if (!Number.isSafeInteger(claimSlots) || claimSlots < 1 || claimSlots > 50) {
  throw new Error("--slots must be an integer from 1 to 50.");
}

const cases = readJsonl(datasetPath);
if (!cases.length) throw new Error("Dataset is empty.");
const ids = new Set();
for (const item of cases) {
  if (typeof item.id !== "string" || !item.id || ids.has(item.id)) {
    throw new Error("Every dataset row needs a unique string id.");
  }
  ids.add(item.id);
  if (typeof item.promptQuery !== "string" || typeof item.finalResponse !== "string") {
    throw new Error(`${item.id}: promptQuery and finalResponse must be strings.`);
  }
  if (!Array.isArray(item.evidence)) throw new Error(`${item.id}: evidence must be an array.`);
  if (new Set(item.evidence.map((event) => event.promptId)).size > 1) {
    throw new Error(`${item.id}: evidence contains more than one promptId.`);
  }
}

const columns = [
  "worksheet_version",
  "worksheet_id",
  "annotator_slot",
  "session_id",
  "prompt",
  "final_response",
  "evidence_references",
  "claim_slot",
  "claim_id",
  "source_quote",
  "claim_type",
  "target",
  "expected_result",
  "annotator_verdict",
  "rationale",
  "evidence_event_ids",
  "test_tampering",
  "capture_completeness",
  "annotation_status",
  "notes",
];

function referencesFor(item) {
  return item.evidence.map((event) => ({
    promptId: event.promptId,
    eventId: event.eventId,
    sequenceNumber: event.sequenceNumber,
    eventType: event.eventType,
    outcome: event.outcome,
    occurredAt: event.occurredAt,
    ...(event.target === undefined ? {} : { target: event.target }),
    metadata: event.metadata ?? {},
  }));
}

mkdirSync(outputDirectory, { recursive: true });
const written = [];
for (const slot of ["a", "b"]) {
  const rows = [columns];
  for (const item of cases) {
    const evidenceReferences = JSON.stringify(referencesFor(item));
    for (let claimSlot = 1; claimSlot <= claimSlots; claimSlot++) {
      rows.push([
        "natural-v1-worksheet-v1",
        `${item.id}::${claimSlot}`,
        slot.toUpperCase(),
        item.id,
        item.promptQuery,
        item.finalResponse,
        evidenceReferences,
        String(claimSlot),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
    }
  }
  const path = resolve(outputDirectory, `natural-v1.annotator-${slot}.csv`);
  writeFileSync(path, toCsv(rows), { encoding: "utf8", flag: force ? "w" : "wx" });
  written.push(path);
}

console.log(
  JSON.stringify(
    {
      dataset: datasetPath,
      sessions: cases.length,
      claimSlots,
      worksheets: written,
      note: "Worksheets contain no extracted claims, TraceForge verdicts, gold verdicts, or claims.csv rows.",
    },
    null,
    2,
  ),
);
