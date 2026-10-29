import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
  AppendTraceEventInput,
  AppendTraceEventResult,
  CreateVerificationSessionInput,
  ListVerificationSessionsInput,
  SaveClaimVerificationInput,
  SaveExtractedClaimInput,
  UpdateVerificationSessionSummaryInput,
  VerificationClaimRecord,
  VerificationOverviewRecord,
  VerificationRepository,
  VerificationSessionDayRecord,
  VerificationSessionDetails,
  VerificationSessionSummaryRecord,
  VerificationTraceEventRecord
} from "../../application/ports/verification-repository.js";
import type { VerificationEvidence } from "../../domain/contracts.js";
import { isClaimType } from "../../domain/claim-types.js";
import { isExecutionStatus, isProcessingStatus } from "../../domain/statuses.js";
import { isTraceEventOutcome, isTraceEventType } from "../../domain/trace-event-types.js";
import { isVerdictReasonCode, isVerificationVerdict } from "../../domain/verdicts.js";
import { createTraceEventHash } from "../integrity/trace-event-hash.js";

interface SessionIdRow { readonly id: number; }
interface ExistingEventRow { readonly id: number; readonly sequence_number: number; readonly event_hash: string; }
interface LastEventRow { readonly sequence_number: number; readonly event_hash: string; }
interface ClaimIdRow { readonly id: number; }

interface SessionSummaryRow {
  readonly processing_metrics_json: string | null;
  readonly id: number;
  readonly prompt_id: string;
  readonly prompt_query: string | null;
  readonly external_session_id: string;
  readonly run_id: string;
  readonly project_name: string | null;
  readonly project_path: string | null;
  readonly agent_name: string;
  readonly model_name: string;
  readonly execution_status: string;
  readonly extraction_status: string;
  readonly verification_status: string;
  readonly total_claims: number;
  readonly verified_claims: number;
  readonly contradicted_claims: number;
  readonly unsupported_claims: number;
  readonly unverifiable_claims: number;
  readonly scored_claims: number;
  readonly reliability_percent: number | null;
  readonly coverage_percent: number | null;
  readonly started_at: string;
  readonly completed_at: string | null;
}

interface SessionDayRow {
  readonly session_date: string;
  readonly queries: number;
  readonly total_claims: number;
  readonly verified_claims: number;
  readonly contradicted_claims: number;
  readonly unsupported_claims: number;
  readonly unverifiable_claims: number;
  readonly scored_claims: number;
}

interface ClaimRecordRow {
  readonly claim_index: number;
  readonly claim_text: string;
  readonly claim_type: string;
  readonly target: string;
  readonly expected_result: string;
  readonly verdict: string | null;
  readonly verdict_reason_code: string | null;
  readonly verdict_explanation: string | null;
  readonly evidence_event_ids: string;
  readonly extractor_model: string;
  readonly extraction_prompt_version: string;
  readonly verification_rule_version: string;
  readonly verified_at: string | null;
}

interface TraceEventRecordRow {
  readonly id: number;
  readonly source_event_id: string;
  readonly sequence_number: number;
  readonly event_type: string;
  readonly outcome: string;
  readonly occurred_at: string;
  readonly target: string | null;
  readonly tool_name: string | null;
  readonly file_path: string | null;
  readonly command_text: string | null;
  readonly working_directory: string | null;
  readonly exit_code: number | null;
  readonly test_passed: number | null;
  readonly test_failed: number | null;
  readonly test_skipped: number | null;
  readonly file_existed_before: number | null;
  readonly file_exists_after: number | null;
  readonly file_hash_before: string | null;
  readonly file_hash_after: string | null;
  readonly output_hash: string | null;
  readonly previous_event_hash: string | null;
  readonly event_hash: string;
  readonly metadata_json: string;
}

interface OverviewRow {
  readonly total_sessions: number;
  readonly total_claims: number;
  readonly verified_claims: number;
  readonly contradicted_claims: number;
  readonly unsupported_claims: number;
  readonly unverifiable_claims: number;
  readonly scored_claims: number;
}

const SESSION_SUMMARY_SELECT = `SELECT session.id, session.prompt_id,
  result.PromptQuery AS prompt_query, session.external_session_id, session.run_id,
  session.project_name, session.project_path, session.agent_name, session.model_name,
  session.execution_status, session.extraction_status, session.verification_status,
  session.total_claims, session.verified_claims, session.contradicted_claims,
  session.unsupported_claims, session.unverifiable_claims, session.scored_claims,
  session.reliability_percent, session.coverage_percent, session.started_at,
  session.completed_at, session.processing_metrics_json
  FROM execution_sessions AS session
  LEFT JOIN prompt_results AS result ON result.id = session.prompt_result_id`;

/** SQLite implementation of the immutable verification persistence boundary. */
export class SqliteVerificationRepository implements VerificationRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public async createSession(input: CreateVerificationSessionInput): Promise<void> {
    this.database.prepare(
      `INSERT INTO execution_sessions (
        prompt_id, external_session_id, run_id, prompt_result_id, project_name,
        project_path, agent_name, model_name, policy_version, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(prompt_id) DO NOTHING`
    ).run(
      input.promptId, input.externalSessionId, input.runId, input.promptResultId,
      input.projectName, input.projectPath, input.agentName, input.modelName,
      input.policyVersion, isoDateTime(input.startedAt)
    );
  }

  public async attachPromptResult(promptId: string, promptResultId: number): Promise<void> {
    const sessionId = this.requireSessionId(promptId);
    this.database.prepare(
      `UPDATE execution_sessions
       SET prompt_result_id = COALESCE(prompt_result_id, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(promptResultId, sessionId);
  }

  public async appendTraceEvent(input: AppendTraceEventInput): Promise<AppendTraceEventResult> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const executionSessionId = this.requireSessionId(input.promptId);
      const existing = getOne<ExistingEventRow>(
        this.database,
        `SELECT id, sequence_number, event_hash FROM trace_events
         WHERE execution_session_id = ? AND source_event_id = ?`,
        [executionSessionId, input.sourceEventId]
      );
      if (existing) {
        this.database.exec("COMMIT");
        return {
          traceEventId: existing.id,
          sequenceNumber: existing.sequence_number,
          eventHash: existing.event_hash,
          deduplicated: true
        };
      }

      const lastEvent = getOne<LastEventRow>(
        this.database,
        `SELECT sequence_number, event_hash FROM trace_events
         WHERE execution_session_id = ? ORDER BY sequence_number DESC LIMIT 1`,
        [executionSessionId]
      );
      const sequenceNumber = (lastEvent?.sequence_number ?? 0) + 1;
      const previousEventHash = lastEvent?.event_hash ?? null;
      const target = input.target ?? null;
      const eventHash = createTraceEventHash({
        previousEventHash,
        promptId: input.promptId,
        sourceEventId: input.sourceEventId,
        sequenceNumber,
        eventType: input.eventType,
        outcome: input.outcome,
        occurredAt: input.occurredAt,
        target,
        metadata: input.metadata
      });
      const projection = input.projections;
      const result = this.database.prepare(
        `INSERT INTO trace_events (
          execution_session_id, source_event_id, sequence_number, event_type, outcome,
          occurred_at, target, tool_name, file_path, command_text, working_directory,
          exit_code, test_passed, test_failed, test_skipped, file_existed_before,
          file_exists_after, file_hash_before, file_hash_after, output_hash,
          previous_event_hash, event_hash, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        executionSessionId, input.sourceEventId, sequenceNumber, input.eventType,
        input.outcome, isoDateTime(input.occurredAt), target,
        projection?.toolName ?? null, projection?.filePath ?? null,
        projection?.command ?? null, projection?.workingDirectory ?? null,
        projection?.exitCode ?? null, projection?.testPassed ?? null,
        projection?.testFailed ?? null, projection?.testSkipped ?? null,
        sqliteBoolean(projection?.fileExistedBefore),
        sqliteBoolean(projection?.fileExistsAfter), projection?.fileHashBefore ?? null,
        projection?.fileHashAfter ?? null, projection?.outputHash ?? null,
        previousEventHash, eventHash, JSON.stringify(input.metadata)
      );
      this.database.exec("COMMIT");
      return {
        traceEventId: Number(result.lastInsertRowid),
        sequenceNumber,
        eventHash,
        deduplicated: false
      };
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  public async loadVerificationEvidence(promptId: string): Promise<readonly VerificationEvidence[]> {
    const rows = getAll<TraceEventRecordRow>(
      this.database,
      `${TRACE_EVENT_SELECT}
       INNER JOIN execution_sessions AS session ON session.id = event.execution_session_id
       WHERE session.prompt_id = ? ORDER BY event.sequence_number ASC`,
      [promptId]
    );
    return rows.map(row => mapVerificationEvidence(promptId, row));
  }

  public async saveExtractedClaim(input: SaveExtractedClaimInput): Promise<void> {
    const sessionId = this.requireSessionId(input.promptId);
    this.database.prepare(
      `INSERT INTO agent_claims (
        execution_session_id, claim_index, claim_text, claim_type, target,
        expected_result, evidence_event_ids, extractor_model,
        extraction_prompt_version, verification_rule_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(execution_session_id, claim_index) DO UPDATE SET
        claim_text = excluded.claim_text,
        claim_type = excluded.claim_type,
        target = excluded.target,
        expected_result = excluded.expected_result,
        extractor_model = excluded.extractor_model,
        extraction_prompt_version = excluded.extraction_prompt_version,
        verification_rule_version = excluded.verification_rule_version,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    ).run(
      sessionId, input.claimIndex, input.claimText, input.claimType, input.target,
      input.expectedResult, JSON.stringify([]), input.extractorModel,
      input.extractionPromptVersion, input.verificationRuleVersion
    );
  }

  public async saveClaimVerification(input: SaveClaimVerificationInput): Promise<void> {
    const claim = getOne<ClaimIdRow>(
      this.database,
      `SELECT claim.id FROM agent_claims AS claim
       INNER JOIN execution_sessions AS session ON session.id = claim.execution_session_id
       WHERE session.prompt_id = ? AND claim.claim_index = ?`,
      [input.promptId, input.claimIndex]
    );
    if (!claim) throw new Error(`Verification claim ${input.claimIndex} was not found for prompt ${input.promptId}`);
    this.database.prepare(
      `UPDATE agent_claims SET verdict = ?, verdict_reason_code = ?,
       verdict_explanation = ?, evidence_event_ids = ?, verification_rule_version = ?,
       verified_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      input.verdict, input.reasonCode, input.explanation,
      JSON.stringify(input.evidence.map(value => value.eventId)), input.ruleVersion,
      isoDateTime(input.verifiedAt), claim.id
    );
  }

  public async updateSessionSummary(input: UpdateVerificationSessionSummaryInput): Promise<void> {
    const sessionId = this.requireSessionId(input.promptId);
    const { counts } = input.summary;
    this.database.prepare(
      `UPDATE execution_sessions SET execution_status = ?, extraction_status = ?,
       verification_status = ?, total_claims = ?, verified_claims = ?,
       contradicted_claims = ?, unsupported_claims = ?, unverifiable_claims = ?,
       scored_claims = ?, reliability_percent = ?, coverage_percent = ?, completed_at = ?,
       processing_metrics_json = COALESCE(?, processing_metrics_json),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
    ).run(
      input.executionStatus, input.extractionStatus, input.verificationStatus,
      counts.totalClaims, counts.verified, counts.contradicted, counts.unsupported,
      counts.unverifiable, input.summary.scoredClaims, input.summary.reliabilityPercent,
      input.summary.coveragePercent, isoDateTime(input.completedAt),
      input.processingMetrics ? JSON.stringify(input.processingMetrics) : null, sessionId
    );
  }

  public async listSessions(input: ListVerificationSessionsInput): Promise<readonly VerificationSessionSummaryRecord[]> {
    const filter = dateFilter(input, "session.started_at");
    const rows = getAll<SessionSummaryRow>(
      this.database,
      `${SESSION_SUMMARY_SELECT} ${filter.where}
       ORDER BY session.started_at DESC, session.id DESC LIMIT ? OFFSET ?`,
      [...filter.parameters, input.limit, input.offset]
    );
    return rows.map(mapSessionSummary);
  }

  public async listSessionDays(input: ListVerificationSessionsInput): Promise<readonly VerificationSessionDayRecord[]> {
    const filter = dateFilter(input, "started_at");
    const days = getAll<SessionDayRow>(
      this.database,
      `SELECT substr(started_at, 1, 10) AS session_date, COUNT(*) AS queries,
       COALESCE(SUM(total_claims), 0) AS total_claims,
       COALESCE(SUM(verified_claims), 0) AS verified_claims,
       COALESCE(SUM(contradicted_claims), 0) AS contradicted_claims,
       COALESCE(SUM(unsupported_claims), 0) AS unsupported_claims,
       COALESCE(SUM(unverifiable_claims), 0) AS unverifiable_claims,
       COALESCE(SUM(scored_claims), 0) AS scored_claims
       FROM execution_sessions ${filter.where}
       GROUP BY substr(started_at, 1, 10) ORDER BY session_date DESC LIMIT ? OFFSET ?`,
      [...filter.parameters, input.limit, input.offset]
    );
    if (days.length === 0) return [];

    const dates = days.map(row => row.session_date);
    const placeholders = dates.map(() => "?").join(", ");
    const sessionFilter = dateFilter(input, "session.started_at");
    const connector = sessionFilter.where ? " AND " : " WHERE ";
    const sessions = getAll<SessionSummaryRow>(
      this.database,
      `${SESSION_SUMMARY_SELECT} ${sessionFilter.where}${connector}
       substr(session.started_at, 1, 10) IN (${placeholders})
       ORDER BY session.started_at DESC, session.id DESC`,
      [...sessionFilter.parameters, ...dates]
    ).map(mapSessionSummary);
    const sessionsByDate = new Map<string, VerificationSessionSummaryRecord[]>();
    for (const session of sessions) {
      const date = session.startedAt.slice(0, 10);
      const values = sessionsByDate.get(date) ?? [];
      values.push(session);
      sessionsByDate.set(date, values);
    }
    return days.map(row => ({
      date: row.session_date,
      queries: row.queries,
      totalClaims: row.total_claims,
      verifiedClaims: row.verified_claims,
      contradictedClaims: row.contradicted_claims,
      unsupportedClaims: row.unsupported_claims,
      unverifiableClaims: row.unverifiable_claims,
      reliabilityPercent: row.scored_claims === 0 ? null : roundPercent(row.verified_claims / row.scored_claims),
      sessions: sessionsByDate.get(row.session_date) ?? []
    }));
  }

  public async getSessionDetails(promptId: string): Promise<VerificationSessionDetails | null> {
    const session = getOne<SessionSummaryRow>(
      this.database,
      `${SESSION_SUMMARY_SELECT} WHERE session.prompt_id = ?`,
      [promptId]
    );
    if (!session) return null;
    const claims = getAll<ClaimRecordRow>(
      this.database,
      `SELECT claim_index, claim_text, claim_type, target, expected_result, verdict,
       verdict_reason_code, verdict_explanation, evidence_event_ids, extractor_model,
       extraction_prompt_version, verification_rule_version, verified_at
       FROM agent_claims WHERE execution_session_id = ? ORDER BY claim_index ASC`,
      [session.id]
    );
    const events = getAll<TraceEventRecordRow>(
      this.database,
      `${TRACE_EVENT_SELECT} WHERE event.execution_session_id = ?
       ORDER BY event.sequence_number ASC`,
      [session.id]
    );
    return {
      session: mapSessionSummary(session),
      claims: claims.map(mapClaimRecord),
      traceEvents: events.map(mapTraceEventRecord)
    };
  }

  public async getOverview(input: Pick<ListVerificationSessionsInput, "startedAfter" | "startedBefore">): Promise<VerificationOverviewRecord> {
    const filter = dateFilter(input, "started_at");
    const row = getOne<OverviewRow>(
      this.database,
      `SELECT COUNT(*) AS total_sessions, COALESCE(SUM(total_claims), 0) AS total_claims,
       COALESCE(SUM(verified_claims), 0) AS verified_claims,
       COALESCE(SUM(contradicted_claims), 0) AS contradicted_claims,
       COALESCE(SUM(unsupported_claims), 0) AS unsupported_claims,
       COALESCE(SUM(unverifiable_claims), 0) AS unverifiable_claims,
       COALESCE(SUM(scored_claims), 0) AS scored_claims
       FROM execution_sessions ${filter.where}`,
      filter.parameters
    );
    const totalClaims = row?.total_claims ?? 0;
    const verifiedClaims = row?.verified_claims ?? 0;
    const scoredClaims = row?.scored_claims ?? 0;
    return {
      totalSessions: row?.total_sessions ?? 0,
      totalClaims,
      verifiedClaims,
      contradictedClaims: row?.contradicted_claims ?? 0,
      unsupportedClaims: row?.unsupported_claims ?? 0,
      unverifiableClaims: row?.unverifiable_claims ?? 0,
      scoredClaims,
      reliabilityPercent: scoredClaims === 0 ? null : roundPercent(verifiedClaims / scoredClaims),
      coveragePercent: totalClaims === 0 ? null : roundPercent(scoredClaims / totalClaims)
    };
  }

  private requireSessionId(promptId: string): number {
    const row = getOne<SessionIdRow>(
      this.database,
      "SELECT id FROM execution_sessions WHERE prompt_id = ?",
      [promptId]
    );
    if (!row) throw new Error(`Verification session was not found for prompt ${promptId}`);
    return row.id;
  }
}

const TRACE_EVENT_SELECT = `SELECT event.id, event.source_event_id,
  event.sequence_number, event.event_type, event.outcome, event.occurred_at,
  event.target, event.tool_name, event.file_path, event.command_text,
  event.working_directory, event.exit_code, event.test_passed, event.test_failed,
  event.test_skipped, event.file_existed_before, event.file_exists_after,
  event.file_hash_before, event.file_hash_after, event.output_hash,
  event.previous_event_hash, event.event_hash, event.metadata_json
  FROM trace_events AS event`;

function getOne<T>(database: DatabaseSync, sql: string, parameters: readonly SQLInputValue[] = []): T | undefined {
  return database.prepare(sql).get(...parameters) as T | undefined;
}

function getAll<T>(database: DatabaseSync, sql: string, parameters: readonly SQLInputValue[] = []): T[] {
  return database.prepare(sql).all(...parameters) as T[];
}

function dateFilter(
  input: Pick<ListVerificationSessionsInput, "startedAfter" | "startedBefore">,
  column: string
): { readonly where: string; readonly parameters: readonly SQLInputValue[] } {
  const conditions: string[] = [];
  const parameters: SQLInputValue[] = [];
  if (input.startedAfter) {
    conditions.push(`${column} >= ?`);
    parameters.push(isoDateTime(input.startedAfter)!);
  }
  if (input.startedBefore) {
    conditions.push(`${column} < ?`);
    parameters.push(isoDateTime(input.startedBefore)!);
  }
  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    parameters
  };
}

function mapSessionSummary(row: SessionSummaryRow): VerificationSessionSummaryRecord {
  if (!isExecutionStatus(row.execution_status)) throw new Error(`Unknown persisted execution status: ${row.execution_status}`);
  if (!isProcessingStatus(row.extraction_status)) throw new Error(`Unknown persisted extraction status: ${row.extraction_status}`);
  if (!isProcessingStatus(row.verification_status)) throw new Error(`Unknown persisted verification status: ${row.verification_status}`);
  return {
    promptId: row.prompt_id,
    promptQuery: row.prompt_query,
    externalSessionId: row.external_session_id,
    runId: row.run_id,
    projectName: row.project_name,
    projectPath: row.project_path,
    agentName: row.agent_name,
    modelName: row.model_name,
    processingMetrics: row.processing_metrics_json ? JSON.parse(row.processing_metrics_json) : null,
    executionStatus: row.execution_status,
    extractionStatus: row.extraction_status,
    verificationStatus: row.verification_status,
    totalClaims: row.total_claims,
    verifiedClaims: row.verified_claims,
    contradictedClaims: row.contradicted_claims,
    unsupportedClaims: row.unsupported_claims,
    unverifiableClaims: row.unverifiable_claims,
    scoredClaims: row.scored_claims,
    reliabilityPercent: row.reliability_percent,
    coveragePercent: row.coverage_percent,
    startedAt: isoDateTime(row.started_at)!,
    completedAt: isoDateTime(row.completed_at)
  };
}

function mapClaimRecord(row: ClaimRecordRow): VerificationClaimRecord {
  if (!isClaimType(row.claim_type)) throw new Error(`Unknown persisted claim type: ${row.claim_type}`);
  if (row.verdict !== null && !isVerificationVerdict(row.verdict)) throw new Error(`Unknown persisted verdict: ${row.verdict}`);
  if (row.verdict_reason_code !== null && !isVerdictReasonCode(row.verdict_reason_code)) throw new Error(`Unknown persisted reason code: ${row.verdict_reason_code}`);
  return {
    claimIndex: row.claim_index,
    claimText: row.claim_text,
    claimType: row.claim_type,
    target: row.target,
    expectedResult: row.expected_result,
    verdict: row.verdict,
    reasonCode: row.verdict_reason_code,
    explanation: row.verdict_explanation,
    evidenceEventIds: stringArray(row.evidence_event_ids),
    extractorModel: row.extractor_model,
    extractionPromptVersion: row.extraction_prompt_version,
    verificationRuleVersion: row.verification_rule_version,
    verifiedAt: isoDateTime(row.verified_at)
  };
}

function mapTraceEventRecord(row: TraceEventRecordRow): VerificationTraceEventRecord {
  validateTraceEvent(row);
  return {
    id: row.id,
    eventId: row.source_event_id,
    sequenceNumber: row.sequence_number,
    eventType: row.event_type,
    outcome: row.outcome,
    occurredAt: isoDateTime(row.occurred_at)!,
    target: row.target,
    toolName: row.tool_name,
    filePath: row.file_path,
    command: row.command_text,
    workingDirectory: row.working_directory,
    exitCode: row.exit_code,
    testPassed: row.test_passed,
    testFailed: row.test_failed,
    testSkipped: row.test_skipped,
    fileExistedBefore: booleanValue(row.file_existed_before),
    fileExistsAfter: booleanValue(row.file_exists_after),
    fileHashBefore: row.file_hash_before,
    fileHashAfter: row.file_hash_after,
    outputHash: row.output_hash,
    previousEventHash: row.previous_event_hash,
    eventHash: row.event_hash,
    metadata: jsonObject(row.metadata_json)
  };
}

function mapVerificationEvidence(promptId: string, row: TraceEventRecordRow): VerificationEvidence {
  validateTraceEvent(row);
  const metadata: Record<string, unknown> = { ...jsonObject(row.metadata_json) };
  assign(metadata, "toolName", row.tool_name);
  assign(metadata, "filePath", row.file_path);
  assign(metadata, "command", row.command_text);
  assign(metadata, "workingDirectory", row.working_directory);
  assign(metadata, "exitCode", row.exit_code);
  assign(metadata, "passed", row.test_passed);
  assign(metadata, "failed", row.test_failed);
  assign(metadata, "skipped", row.test_skipped);
  assign(metadata, "fileExistedBefore", booleanValue(row.file_existed_before));
  assign(metadata, "fileExistsAfter", booleanValue(row.file_exists_after));
  assign(metadata, "fileHashBefore", row.file_hash_before);
  assign(metadata, "fileHashAfter", row.file_hash_after);
  assign(metadata, "outputHash", row.output_hash);
  return {
    promptId,
    eventId: row.source_event_id,
    sequenceNumber: row.sequence_number,
    eventType: row.event_type,
    outcome: row.outcome,
    occurredAt: isoDateTime(row.occurred_at)!,
    ...(row.target ? { target: row.target } : {}),
    metadata
  };
}

function validateTraceEvent(row: TraceEventRecordRow): asserts row is TraceEventRecordRow & {
  readonly event_type: VerificationTraceEventRecord["eventType"];
  readonly outcome: VerificationTraceEventRecord["outcome"];
} {
  if (!isTraceEventType(row.event_type)) throw new Error(`Unknown persisted event type: ${row.event_type}`);
  if (!isTraceEventOutcome(row.outcome)) throw new Error(`Unknown persisted event outcome: ${row.outcome}`);
}

function assign(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== null && value !== undefined) target[key] = value;
}

function sqliteBoolean(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

function booleanValue(value: number | null): boolean | null {
  return value === null ? null : value !== 0;
}

function isoDateTime(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid ISO-8601 timestamp: ${value}`);
  return date.toISOString();
}

function jsonObject(value: string): Readonly<Record<string, unknown>> {
  const parsed = parseJson(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Readonly<Record<string, unknown>>
    : {};
}

function stringArray(value: string): readonly string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; }
  catch { return undefined; }
}

function roundPercent(value: number): number {
  return Math.round(value * 1000) / 10;
}

function rollback(database: DatabaseSync): void {
  try { database.exec("ROLLBACK"); }
  catch { /* Preserve the original transaction failure. */ }
}

