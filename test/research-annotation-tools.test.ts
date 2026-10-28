import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
// @ts-expect-error Research CLI helpers are intentionally plain JavaScript.
import { csvRecords, parseCsv } from "../research/annotation/lib.mjs";

const root = resolve(import.meta.dirname, "..");
const prepare = resolve(root, "research/annotation/prepare-worksheets.mjs");
const build = resolve(root, "research/annotation/build-adjudicated-dataset.mjs");
const header = [
  "session_id", "claim_id", "source_quote", "claim_type", "target", "expected_result",
  "annotator_a_verdict", "annotator_b_verdict", "adjudicated_verdict", "rationale",
  "evidence_event_ids", "test_tampering", "capture_completeness", "session_status",
  "adjudication_status", "adjudicator_id", "adjudicated_at",
];
const cell = (value: unknown) => `"${String(value ?? "").replace(/"/gu, '""')}"`;
const csv = (rows: unknown[][]) => rows.map(row => row.map(cell).join(",")).join("\n") + "\n";

function run(script: string, args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

function fixture() {
  return [
    {
      id: "s1", promptQuery: "Create a.txt.", finalResponse: "Created a.txt.",
      evidence: [
        { promptId: "s1", eventId: "e1", sequenceNumber: 1, eventType: "FILE_CREATED", outcome: "SUCCEEDED", occurredAt: "2026-01-01T00:00:00.000Z", target: "a.txt", metadata: { fileExistsAfter: true } },
        { promptId: "s1", eventId: "e2", sequenceNumber: 2, eventType: "FINAL_RESPONSE_CAPTURED", outcome: "RECORDED", occurredAt: "2026-01-01T00:00:01.000Z", metadata: {} },
      ],
      goldClaims: [], annotationStatus: "unannotated", metadata: { model: "fixture" },
    },
    {
      id: "s2", promptQuery: "Say hello.", finalResponse: "Hi! How can I help?",
      evidence: [{ promptId: "s2", eventId: "e3", sequenceNumber: 1, eventType: "FINAL_RESPONSE_CAPTURED", outcome: "RECORDED", occurredAt: "2026-01-01T00:00:02.000Z", metadata: {} }],
      goldClaims: [], annotationStatus: "unannotated", metadata: { model: "fixture" },
    },
  ];
}

function validRows() {
  return [
    header,
    ["s1", "C1", "Created a.txt.", "FILE_CREATED", "a.txt", "", "VERIFIED", "VERIFIED", "VERIFIED", "The file-created event confirms it.", '["e1"]', "FALSE", "COMPLETE", "CLAIMS_PRESENT", "ADJUDICATED", "adj-1", "2026-01-02T00:00:00.000Z"],
    ["s2", "", "", "", "", "", "NO_CLAIMS", "NO_CLAIMS", "NO_CLAIMS", "Both annotators found no factual claims.", "[]", "FALSE", "COMPLETE", "NO_CLAIMS", "ADJUDICATED", "adj-1", "2026-01-02T00:00:00.000Z"],
  ];
}

it("writes two blind worksheets with context but no predictions", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-worksheets-"));
  try {
    const dataset = join(dir, "dataset.jsonl");
    writeFileSync(dataset, fixture().map(row => JSON.stringify(row)).join("\n") + "\n");
    const result = run(prepare, ["--dataset", dataset, "--out-dir", dir, "--slots", "2"]);
    expect(result.status, result.stderr).toBe(0);
    for (const slot of ["a", "b"]) {
      const text = readFileSync(join(dir, `natural-v1.annotator-${slot}.csv`), "utf8");
      expect(text).toContain('"session_id"');
      expect(text).toContain('"prompt"');
      expect(text).toContain('"final_response"');
      expect(text).toContain('"evidence_references"');
      expect(text).toContain('"annotator_verdict"');
      expect(text).not.toContain("traceforge_verdict");
      expect(text).not.toContain("gold_verdict");
      expect(text).not.toContain("goldClaims");
      expect(text).not.toContain("extractor_model");
      expect(text).not.toContain("Created a.txt.\",\"FILE_CREATED\"");
      expect(text).toContain(`"${slot.toUpperCase()}"`);
      expect(text).toContain("e1");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects blank or partially adjudicated annotation files", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-incomplete-"));
  try {
    const dataset = join(dir, "dataset.jsonl"), annotations = join(dir, "annotations.csv");
    writeFileSync(dataset, fixture().map(row => JSON.stringify(row)).join("\n") + "\n");
    writeFileSync(annotations, csv([header]));
    const result = run(build, ["--dataset", dataset, "--annotations", annotations, "--output", join(dir, "out.jsonl")]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("Adjudication is incomplete");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("builds the adjudicated JSONL and preserves evidence exactly", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-build-"));
  try {
    const rows = fixture();
    const dataset = join(dir, "dataset.jsonl"), annotations = join(dir, "annotations.csv"), output = join(dir, "out.jsonl");
    writeFileSync(dataset, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    writeFileSync(annotations, csv(validRows()));
    const result = run(build, ["--dataset", dataset, "--annotations", annotations, "--output", output]);
    expect(result.status, result.stderr).toBe(0);
    const built = readFileSync(output, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(built).toHaveLength(2);
    expect(built[0].evidence).toEqual(rows[0]!.evidence);
    expect(built[0].annotationStatus).toBe("adjudicated");
    expect(built[0].goldClaims[0]).toMatchObject({
      claimIndex: 1, claimId: "C1", claimText: "Created a.txt.", sourceQuote: "Created a.txt.",
      claimType: "FILE_CREATED", target: "a.txt", expectedResult: "target exists after the change",
      verdict: "VERIFIED", evidenceEventIds: ["e1"], testTampering: false, captureCompleteness: "COMPLETE",
    });
    expect(built[0].metadata.model).toBe("fixture");
    expect(built[0].metadata.adjudication.annotationFileSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(built[1].goldClaims).toEqual([]);
    expect(built[1].annotationStatus).toBe("adjudicated");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects invented quotes, unknown evidence, and non-adjudicated rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-invalid-"));
  try {
    const dataset = join(dir, "dataset.jsonl");
    writeFileSync(dataset, fixture().map(row => JSON.stringify(row)).join("\n") + "\n");
    const cases = [
      { row: 1, column: 2, value: "Invented a.txt.", expected: "not an exact substring" },
      { row: 1, column: 10, value: '["not-an-event"]', expected: "is not in s1" },
      { row: 1, column: 14, value: "PENDING", expected: "must be ADJUDICATED" },
      { row: 1, column: 10, value: "[]", expected: "requires supporting evidence_event_ids" },
    ];
    for (const testCase of cases) {
      const rows = validRows();
      rows[testCase.row]![testCase.column] = testCase.value;
      const annotations = join(dir, `invalid-${testCase.column}.csv`);
      writeFileSync(annotations, csv(rows));
      const result = run(build, ["--dataset", dataset, "--annotations", annotations, "--output", join(dir, `out-${testCase.column}.jsonl`)]);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(testCase.expected);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("preserves an independently missed claim marker without inventing a raw verdict", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-missed-"));
  try {
    const dataset = join(dir, "dataset.jsonl"), annotations = join(dir, "annotations.csv"), output = join(dir, "out.jsonl");
    writeFileSync(dataset, fixture().map(row => JSON.stringify(row)).join("\n") + "\n");
    const rows = validRows(); rows[1]![6] = "NOT_IDENTIFIED";
    writeFileSync(annotations, csv(rows));
    expect(run(build, ["--dataset", dataset, "--annotations", annotations, "--output", output]).status).toBe(0);
    const first = JSON.parse(readFileSync(output, "utf8").split("\n")[0]!);
    expect(first.goldClaims[0].annotatorVerdicts.a).toBe("NOT_IDENTIFIED");
    expect(first.goldClaims[0].verdict).toBe("VERIFIED");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("exports matched, missed and spurious claims with gold details and aggregate extraction counts", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-export-"));
  try {
    const dataset = join(dir, "dataset.jsonl"), output = join(dir, "exports");
    const gold = { claimIndex: 1, claimText: "Created a.txt.", claimType: "FILE_CREATED", target: "a.txt", expectedResult: "exists", verdict: "VERIFIED" };
    writeFileSync(dataset, JSON.stringify({ id: "s1", goldClaims: [gold, { ...gold, claimIndex: 2, target: "b.txt" }] }) + "\n");
    writeFileSync(join(dir, "metrics.json"), JSON.stringify({ "oracle/deterministic": { accuracy: 0.5, goldClaims: 2, clusters: 1 } }));
    writeFileSync(join(dir, "predictions.jsonl"), JSON.stringify({ id: "s1", extractor: "oracle", baseline: "deterministic", claims: [gold, { ...gold, target: "c.txt", claimIndex: 2 }], decisions: [{ verdict: "VERIFIED" }, { verdict: "UNSUPPORTED" }], alignment: [{ goldIndex: 0, predictedIndex: 0 }] }) + "\n");
    writeFileSync(join(dir, "extraction.jsonl"), [{ id: "s1", extractor: "oracle", gold: 2, predicted: 2, matched: 1 }, { id: "s2", extractor: "oracle", gold: 1, predicted: 0, matched: 0, failed: true }].map(x => JSON.stringify(x)).join("\n"));
    const result = run(resolve(root, "research/annotation/export-evaluation-suite.mjs"), ["--dataset", dataset, "--run-dir", dir, "--out-dir", output]);
    expect(result.status, result.stderr).toBe(0);
    const claims = csvRecords(parseCsv(readFileSync(join(output, "per-claim.csv"), "utf8"))).records;
    expect(claims).toHaveLength(3);
    expect(claims[0].gold_verdict).toBe("VERIFIED");
    expect(claims[1].gold_target).toBe("b.txt");
    expect(claims[2].predicted_target).toBe("c.txt");
    const extraction = csvRecords(parseCsv(readFileSync(join(output, "extraction-summary.csv"), "utf8"))).records;
    expect(extraction).toHaveLength(1);
    expect(extraction[0]).toMatchObject({ sessions: "2", gold_claims: "3", matched_claims: "1", failed: "1" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
