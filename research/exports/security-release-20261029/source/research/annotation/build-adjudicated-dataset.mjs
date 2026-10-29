#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  csvRecords,
  parseArgs,
  parseBoolean,
  parseCsv,
  parseStringList,
  readJsonl,
  requireIsoDate,
  sha256,
} from "./lib.mjs";

const CLAIM_TYPES = new Set([
  "FILE_CREATED",
  "FILE_MODIFIED",
  "STRUCTURE_CREATED",
  "DEPENDENCY_RULE",
  "COMMAND_SUCCEEDED",
  "BUILD_PASSED",
  "TEST_PASSED",
  "TASK_COMPLETED",
]);
const VERDICTS = new Set(["VERIFIED", "CONTRADICTED", "UNSUPPORTED", "UNVERIFIABLE"]);
const CAPTURE_COMPLETENESS = new Set(["COMPLETE", "INCOMPLETE", "NOT_AVAILABLE"]);
const EXPECTED_RESULTS = {
  FILE_CREATED: "target exists after the change",
  FILE_MODIFIED: "target changed to the claimed implementation",
  STRUCTURE_CREATED: "claimed structure exists",
  DEPENDENCY_RULE: "dependency rule passes without forbidden imports",
  COMMAND_SUCCEEDED: "matching command exits with code 0",
  BUILD_PASSED: "exitCode equals 0",
  TEST_PASSED: "exitCode equals 0 and failed equals 0",
  TASK_COMPLETED: "all required objective claims are verified",
};
const REQUIRED_COLUMNS = [
  "session_id",
  "claim_id",
  "source_quote",
  "claim_type",
  "target",
  "annotator_a_verdict",
  "annotator_b_verdict",
  "adjudicated_verdict",
  "rationale",
  "evidence_event_ids",
  "test_tampering",
  "capture_completeness",
  "session_status",
  "adjudication_status",
  "adjudicator_id",
  "adjudicated_at",
];

const args = parseArgs(process.argv.slice(2));
const datasetPath = resolve(args.dataset ?? "research/datasets/natural-v1.jsonl");
const annotationsPath = resolve(
  args.annotations ?? "research/datasets/natural-v1.adjudications.csv",
);
const outputPath = resolve(
  args.output ?? "research/datasets/natural-v1-adjudicated.jsonl",
);
const dryRun = args["dry-run"] === true;
const force = args.force === true;

if (datasetPath === outputPath) throw new Error("Output must not overwrite the source dataset.");
if (!existsSync(annotationsPath)) {
  throw new Error(
    `Adjudication file not found: ${annotationsPath}\n` +
      "Create it from the two completed annotator worksheets. Blank or unfinished annotations are not accepted.",
  );
}
if (!dryRun && existsSync(outputPath) && !force) {
  throw new Error(`Refusing to overwrite existing adjudicated dataset: ${outputPath}. Use --force only after review.`);
}

const cases = readJsonl(datasetPath);
if (!cases.length) throw new Error("Source dataset is empty.");
const caseBySession = new Map();
for (const item of cases) {
  if (typeof item.id !== "string" || !item.id || caseBySession.has(item.id)) {
    throw new Error("The source dataset needs unique string ids.");
  }
  if (typeof item.finalResponse !== "string") {
    throw new Error(`${item.id}: finalResponse must be a string.`);
  }
  if (!Array.isArray(item.evidence)) throw new Error(`${item.id}: evidence must be an array.`);
  const eventIds = new Set();
  for (const event of item.evidence) {
    if (!event.eventId || eventIds.has(event.eventId) || event.promptId !== item.id) {
      throw new Error(`${item.id}: evidence needs unique event IDs belonging to this session.`);
    }
    eventIds.add(event.eventId);
  }
  if (item.annotationStatus === "adjudicated") {
    throw new Error(`${item.id}: source dataset is already adjudicated; use the frozen unannotated export.`);
  }
  caseBySession.set(item.id, item);
}

const annotationText = readFileSync(annotationsPath, "utf8");
const parsed = csvRecords(parseCsv(annotationText));
const missingColumns = REQUIRED_COLUMNS.filter((column) => !parsed.headers.includes(column));
if (missingColumns.length) {
  throw new Error(`Adjudication CSV is missing required columns: ${missingColumns.join(", ")}`);
}

const rowsBySession = new Map();
for (const [index, raw] of parsed.records.entries()) {
  const row = { ...raw, __row: index + 2 };
  if (!row.session_id) throw new Error(`CSV row ${row.__row}: session_id is required.`);
  if (!caseBySession.has(row.session_id)) {
    throw new Error(`CSV row ${row.__row}: unknown session_id ${row.session_id}.`);
  }
  if (!rowsBySession.has(row.session_id)) rowsBySession.set(row.session_id, []);
  rowsBySession.get(row.session_id).push(row);
}

const missingSessions = cases
  .map((item) => item.id)
  .filter((id) => !rowsBySession.has(id));
if (missingSessions.length) {
  throw new Error(
    `Adjudication is incomplete. Missing sessions (${missingSessions.length}): ${missingSessions.join(", ")}`,
  );
}

const adjudicatedCases = [];
const adjudicatorIds = new Set();
let totalClaims = 0;
let noClaimsSessions = 0;

function required(row, column) {
  const value = String(row[column] ?? "").trim();
  if (!value) throw new Error(`CSV row ${row.__row}: ${column} is required.`);
  return value;
}

function validateVerdict(row, column, allowMissed = false) {
  const value = required(row, column);
  if (allowMissed && value === "NOT_IDENTIFIED") return value;
  if (!VERDICTS.has(value)) {
    throw new Error(`CSV row ${row.__row}: ${column} must be one of ${[...VERDICTS].join(", ")}.`);
  }
  return value;
}

for (const item of cases) {
  const rows = rowsBySession.get(item.id);
  const statuses = new Set(rows.map((row) => String(row.session_status ?? "").trim()));
  if (statuses.size !== 1) {
    throw new Error(
      `${item.id}: every row must use the same session_status (found ${[...statuses].join(", ") || "blank"}).`,
    );
  }
  const sessionStatus = [...statuses][0];
  const evidenceById = new Map(item.evidence.map((event) => [event.eventId, event]));

  if (sessionStatus === "NO_CLAIMS") {
    if (rows.length !== 1) {
      throw new Error(`${item.id}: NO_CLAIMS requires exactly one adjudication row.`);
    }
    const row = rows[0];
    for (const column of ["claim_id", "source_quote", "claim_type", "target", "expected_result"]) {
      if (String(row[column] ?? "").trim()) {
        throw new Error(`${item.id}: NO_CLAIMS row ${row.__row} must leave ${column} blank.`);
      }
    }
    for (const column of ["annotator_a_verdict", "annotator_b_verdict", "adjudicated_verdict"]) {
      if (required(row, column) !== "NO_CLAIMS") {
        throw new Error(`${item.id}: NO_CLAIMS row ${row.__row} must set ${column}=NO_CLAIMS.`);
      }
    }
    if (required(row, "adjudication_status").toUpperCase() !== "ADJUDICATED") {
      throw new Error(`${item.id}: row ${row.__row} is not marked ADJUDICATED.`);
    }
    required(row, "rationale");
    const captureCompleteness = required(row, "capture_completeness");
    if (!CAPTURE_COMPLETENESS.has(captureCompleteness)) {
      throw new Error(
        `${item.id}: capture_completeness must be one of ${[...CAPTURE_COMPLETENESS].join(", ")}.`,
      );
    }
    if (parseBoolean(row.test_tampering, "test_tampering") !== false) {
      throw new Error(`${item.id}: a NO_CLAIMS row cannot flag test tampering.`);
    }
    const adjudicatorId = required(row, "adjudicator_id");
    const adjudicatedAt = requireIsoDate(row.adjudicated_at, "adjudicated_at");
    if (parseStringList(row.evidence_event_ids).length) {
      throw new Error(`${item.id}: a NO_CLAIMS row must not cite claim evidence.`);
    }
    adjudicatorIds.add(adjudicatorId);
    noClaimsSessions++;
    adjudicatedCases.push({
      ...item,
      goldClaims: [],
      annotationStatus: "adjudicated",
      metadata: {
        ...(item.metadata ?? {}),
        adjudication: {
          schemaVersion: 1,
          annotationFile: basename(annotationsPath),
          annotationFileSha256: sha256(annotationText),
          adjudicatedAt,
          adjudicatorIds: [adjudicatorId],
          claimCount: 0,
          sessionStatus,
        },
      },
    });
    continue;
  }

  if (sessionStatus !== "CLAIMS_PRESENT") {
    throw new Error(`${item.id}: session_status must be CLAIMS_PRESENT or NO_CLAIMS.`);
  }

  const claims = [];
  const claimIds = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const claimId = required(row, "claim_id");
    if (claimIds.has(claimId)) throw new Error(`${item.id}: duplicate claim_id ${claimId}.`);
    claimIds.add(claimId);

    const sourceQuote = String(row.source_quote ?? "");
    if (!sourceQuote.trim()) throw new Error(`CSV row ${row.__row}: source_quote is required.`);
    if (!item.finalResponse.includes(sourceQuote)) {
      throw new Error(
        `CSV row ${row.__row}: source_quote is not an exact substring of the final response.`,
      );
    }
    const claimType = required(row, "claim_type");
    if (!CLAIM_TYPES.has(claimType)) {
      throw new Error(
        `CSV row ${row.__row}: claim_type must be one of ${[...CLAIM_TYPES].join(", ")}; OTHER is not a scorable claim type.`,
      );
    }
    const target = required(row, "target");
    const expectedResult = String(row.expected_result ?? "").trim() || EXPECTED_RESULTS[claimType];
    const annotatorAVerdict = validateVerdict(row, "annotator_a_verdict", true);
    const annotatorBVerdict = validateVerdict(row, "annotator_b_verdict", true);
    const adjudicatedVerdict = validateVerdict(row, "adjudicated_verdict");
    const rationale = required(row, "rationale");
    const captureCompleteness = required(row, "capture_completeness");
    if (!CAPTURE_COMPLETENESS.has(captureCompleteness)) {
      throw new Error(
        `CSV row ${row.__row}: capture_completeness must be one of ${[...CAPTURE_COMPLETENESS].join(", ")}.`,
      );
    }
    if (required(row, "adjudication_status").toUpperCase() !== "ADJUDICATED") {
      throw new Error(`CSV row ${row.__row}: adjudication_status must be ADJUDICATED.`);
    }
    const adjudicatorId = required(row, "adjudicator_id");
    const adjudicatedAt = requireIsoDate(row.adjudicated_at, "adjudicated_at");
    const testTampering = parseBoolean(row.test_tampering, "test_tampering");
    const evidenceEventIds = parseStringList(row.evidence_event_ids);
    if (["VERIFIED", "CONTRADICTED"].includes(adjudicatedVerdict) && !evidenceEventIds.length) {
      throw new Error(`CSV row ${row.__row}: ${adjudicatedVerdict} requires supporting evidence_event_ids.`);
    }
    if (new Set(evidenceEventIds).size !== evidenceEventIds.length) {
      throw new Error(`CSV row ${row.__row}: duplicate evidence_event_ids.`);
    }
    for (const eventId of evidenceEventIds) {
      const event = evidenceById.get(eventId);
      if (!event) {
        throw new Error(`CSV row ${row.__row}: evidence event ${eventId} is not in ${item.id}.`);
      }
      if (event.promptId !== item.id) {
        throw new Error(`CSV row ${row.__row}: evidence event ${eventId} belongs to another prompt.`);
      }
    }

    const duplicateKey = `${claimType}|${target.toLowerCase()}|${sourceQuote.toLowerCase()}`;
    if (duplicates.has(duplicateKey)) {
      throw new Error(`CSV row ${row.__row}: duplicate claim (${claimType}, ${target}, ${sourceQuote}).`);
    }
    duplicates.add(duplicateKey);

    adjudicatorIds.add(adjudicatorId);
    claims.push({
      claimIndex: claims.length + 1,
      claimId,
      claimText: sourceQuote,
      sourceQuote,
      claimType,
      target,
      expectedResult,
      verdict: adjudicatedVerdict,
      annotatorVerdicts: { a: annotatorAVerdict, b: annotatorBVerdict },
      rationale,
      evidenceEventIds,
      testTampering,
      captureCompleteness,
    });
  }

  totalClaims += claims.length;
  adjudicatedCases.push({
    ...item,
    goldClaims: claims,
    annotationStatus: "adjudicated",
    metadata: {
      ...(item.metadata ?? {}),
      adjudication: {
        schemaVersion: 1,
        annotationFile: basename(annotationsPath),
        annotationFileSha256: sha256(annotationText),
        adjudicatedAt: claims.length ? String(rows[0].adjudicated_at).trim() : null,
        adjudicatorIds: [...new Set(rows.map((row) => String(row.adjudicator_id).trim()))],
        claimCount: claims.length,
        sessionStatus,
      },
    },
  });
}

const output = adjudicatedCases.map((item) => JSON.stringify(item)).join("\n") + "\n";
if (!dryRun) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output, { encoding: "utf8", flag: force ? "w" : "wx" });
}

console.log(
  JSON.stringify(
    {
      dataset: datasetPath,
      annotations: annotationsPath,
      output: dryRun ? null : outputPath,
      sessions: adjudicatedCases.length,
      claims: totalClaims,
      noClaimsSessions,
      adjudicators: [...adjudicatorIds],
      dryRun,
    },
    null,
    2,
  ),
);
