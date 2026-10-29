import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CLAIM_TYPES,
  EXECUTION_STATUSES,
  PROCESSING_STATUSES,
  TRACE_EVENT_OUTCOMES,
  TRACE_EVENT_TYPES,
  VERDICT_REASON_CODES,
  VERIFICATION_VERDICTS
} from "../../../src/modules/verification/index.js";

let migration = "";

beforeAll(async () => {
  migration = await readFile(
    resolve("infrastructure/mysql-migrations/009_verification_foundation.sql"),
    "utf8"
  );
});

describe("verification database migration", () => {
  it("creates the three Phase 2 tables without altering prompt_results", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS execution_sessions/u);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS trace_events/u);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS agent_claims/u);
    expect(migration).not.toMatch(/ALTER TABLE\s+prompt_results/iu);
  });

  it("keeps database checks synchronized with the Phase 1 vocabulary", () => {
    for (const value of [
      ...CLAIM_TYPES,
      ...EXECUTION_STATUSES,
      ...PROCESSING_STATUSES,
      ...TRACE_EVENT_TYPES,
      ...TRACE_EVENT_OUTCOMES,
      ...VERIFICATION_VERDICTS,
      ...VERDICT_REASON_CODES
    ]) {
      expect(migration, `missing persisted contract value ${value}`).toContain(`'${value}'`);
    }
  });

  it("enforces prompt identity, event ordering, and claim position uniqueness", () => {
    expect(migration).toContain("uq_execution_sessions_prompt_id");
    expect(migration).toContain("uq_trace_events_source");
    expect(migration).toContain("uq_trace_events_sequence");
    expect(migration).toContain("uq_agent_claims_position");
  });

  it("preserves relational ownership and JSON evidence shape", () => {
    expect(migration).toContain("fk_execution_sessions_prompt_result");
    expect(migration).toContain("fk_trace_events_execution_session");
    expect(migration).toContain("fk_agent_claims_execution_session");
    expect(migration).toMatch(/JSON_TYPE\(`evidence_event_ids`\) = 'ARRAY'/u);
  });
});
