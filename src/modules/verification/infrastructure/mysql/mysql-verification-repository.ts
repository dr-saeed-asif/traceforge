import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
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
import { createTraceEventHash } from "../integrity/trace-event-hash.js";
import { isTraceEventOutcome, isTraceEventType } from "../../domain/trace-event-types.js";
import { isClaimType } from "../../domain/claim-types.js";
import { isVerdictReasonCode, isVerificationVerdict } from "../../domain/verdicts.js";
import { isExecutionStatus, isProcessingStatus } from "../../domain/statuses.js";

interface SessionIdRow extends RowDataPacket {
  readonly id: number;
}

interface ExistingEventRow extends RowDataPacket {
  readonly id: number;
  readonly sequence_number: number;
  readonly event_hash: string;
}

interface LastEventRow extends RowDataPacket {
  readonly sequence_number: number;
  readonly event_hash: string;
}

interface ClaimIdRow extends RowDataPacket {
  readonly id: number;
}

interface SessionSummaryRow extends RowDataPacket {
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
  readonly total_claims: number | string;
  readonly verified_claims: number | string;
  readonly contradicted_claims: number | string;
  readonly unsupported_claims: number | string;
  readonly unverifiable_claims: number | string;
  readonly scored_claims: number | string;
  readonly reliability_percent: number | string | null;
  readonly coverage_percent: number | string | null;
  readonly started_at: Date | string;
  readonly completed_at: Date | string | null;
}

interface SessionDayRow extends RowDataPacket {
  readonly session_date: string;
  readonly queries: number | string;
  readonly total_claims: number | string;
  readonly verified_claims: number | string;
  readonly contradicted_claims: number | string;
  readonly unsupported_claims: number | string;
  readonly unverifiable_claims: number | string;
  readonly scored_claims: number | string;
}

interface ClaimRecordRow extends RowDataPacket {
  readonly claim_index: number;
  readonly claim_text: string;
  readonly claim_type: string;
  readonly target: string;
  readonly expected_result: string;
  readonly verdict: string | null;
  readonly verdict_reason_code: string | null;
  readonly verdict_explanation: string | null;
  readonly evidence_event_ids: unknown;
  readonly extractor_model: string;
  readonly extraction_prompt_version: string;
  readonly verification_rule_version: string;
  readonly verified_at: Date | string | null;
}

interface TraceEventRecordRow extends RowDataPacket {
  readonly id: number;
  readonly source_event_id: string;
  readonly sequence_number: number;
  readonly event_type: string;
  readonly outcome: string;
  readonly occurred_at: Date | string;
  readonly target: string | null;
  readonly tool_name: string | null;
  readonly file_path: string | null;
  readonly command_text: string | null;
  readonly working_directory: string | null;
  readonly exit_code: number | null;
  readonly test_passed: number | null;
  readonly test_failed: number | null;
  readonly test_skipped: number | null;
  readonly file_existed_before: number | boolean | null;
  readonly file_exists_after: number | boolean | null;
  readonly file_hash_before: string | null;
  readonly file_hash_after: string | null;
  readonly output_hash: string | null;
  readonly previous_event_hash: string | null;
  readonly event_hash: string;
  readonly metadata_json: unknown;
}

interface OverviewRow extends RowDataPacket {
  readonly total_sessions: number | string;
  readonly total_claims: number | string;
  readonly verified_claims: number | string;
  readonly contradicted_claims: number | string;
  readonly unsupported_claims: number | string;
  readonly unverifiable_claims: number | string;
  readonly scored_claims: number | string;
}

/** MySQL implementation of the Phase 2 verification persistence boundary. */
export class MysqlVerificationRepository implements VerificationRepository {
  public constructor(private readonly pool: Pool) {}

  public async createSession(input: CreateVerificationSessionInput): Promise<void> {
    await this.pool.execute(
      `INSERT INTO execution_sessions (
        prompt_id, external_session_id, run_id, prompt_result_id, project_name, project_path,
        agent_name, model_name, policy_version, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE prompt_id = prompt_id`,
      [
        input.promptId,
        input.externalSessionId,
        input.runId,
        input.promptResultId,
        input.projectName,
        input.projectPath,
        input.agentName,
        input.modelName,
        input.policyVersion,
        mysqlDateTime(input.startedAt)
      ]
    );
  }

  public async attachPromptResult(promptId: string, promptResultId: number): Promise<void> {
    const executionSessionId = await this.requireSessionId(promptId);
    await this.pool.execute(
      `UPDATE execution_sessions
       SET prompt_result_id = COALESCE(prompt_result_id, ?)
       WHERE id = ?`,
      [promptResultId, executionSessionId]
    );
  }

  public async appendTraceEvent(input: AppendTraceEventInput): Promise<AppendTraceEventResult> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const executionSessionId = await lockExecutionSession(connection, input.promptId);
      const existing = await findExistingEvent(connection, executionSessionId, input.sourceEventId);
      if (existing) {
        await connection.commit();
        return {
          traceEventId: existing.id,
          sequenceNumber: existing.sequence_number,
          eventHash: existing.event_hash,
          deduplicated: true
        };
      }

      const lastEvent = await findLastEvent(connection, executionSessionId);
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
      const projections = input.projections;
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO trace_events (
          execution_session_id, source_event_id, sequence_number, event_type, outcome,
          occurred_at, target, tool_name, file_path, command_text, working_directory,
          exit_code, test_passed, test_failed, test_skipped, file_existed_before,
          file_exists_after, file_hash_before, file_hash_after, output_hash,
          previous_event_hash, event_hash, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          executionSessionId,
          input.sourceEventId,
          sequenceNumber,
          input.eventType,
          input.outcome,
          mysqlDateTime(input.occurredAt),
          target,
          projections?.toolName ?? null,
          projections?.filePath ?? null,
          projections?.command ?? null,
          projections?.workingDirectory ?? null,
          projections?.exitCode ?? null,
          projections?.testPassed ?? null,
          projections?.testFailed ?? null,
          projections?.testSkipped ?? null,
          projections?.fileExistedBefore ?? null,
          projections?.fileExistsAfter ?? null,
          projections?.fileHashBefore ?? null,
          projections?.fileHashAfter ?? null,
          projections?.outputHash ?? null,
          previousEventHash,
          eventHash,
          JSON.stringify(input.metadata)
        ]
      );
      await connection.commit();
      return { traceEventId: result.insertId, sequenceNumber, eventHash, deduplicated: false };
    } catch (error) {
      await rollbackQuietly(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  public async loadVerificationEvidence(promptId: string): Promise<readonly VerificationEvidence[]> {
    const [rows] = await this.pool.execute<TraceEventRecordRow[]>(
      `SELECT event.source_event_id, event.sequence_number, event.event_type, event.outcome,
              event.occurred_at, event.target, event.tool_name, event.file_path,
              event.command_text, event.working_directory, event.exit_code,
              event.test_passed, event.test_failed, event.test_skipped,
              event.file_existed_before, event.file_exists_after,
              event.file_hash_before, event.file_hash_after, event.output_hash,
              event.previous_event_hash, event.event_hash, event.metadata_json,
              event.id
       FROM trace_events AS event
       INNER JOIN execution_sessions AS session ON session.id = event.execution_session_id
       WHERE session.prompt_id = ?
       ORDER BY event.sequence_number ASC`,
      [promptId]
    );
    return rows.map(row => mapVerificationEvidence(promptId, row));
  }

  public async saveExtractedClaim(input: SaveExtractedClaimInput): Promise<void> {
    const executionSessionId = await this.requireSessionId(input.promptId);
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO agent_claims (
        execution_session_id, claim_index, claim_text, claim_type, target, expected_result,
        evidence_event_ids, extractor_model, extraction_prompt_version, verification_rule_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        claim_text = VALUES(claim_text),
        claim_type = VALUES(claim_type),
        target = VALUES(target),
        expected_result = VALUES(expected_result),
        extractor_model = VALUES(extractor_model),
        extraction_prompt_version = VALUES(extraction_prompt_version),
        verification_rule_version = VALUES(verification_rule_version)`,
      [
        executionSessionId,
        input.claimIndex,
        input.claimText,
        input.claimType,
        input.target,
        input.expectedResult,
        JSON.stringify([]),
        input.extractorModel,
        input.extractionPromptVersion,
        input.verificationRuleVersion
      ]
    );
  }

  public async saveClaimVerification(input: SaveClaimVerificationInput): Promise<void> {
    const [rows] = await this.pool.execute<ClaimIdRow[]>(
      `SELECT claim.id
       FROM agent_claims AS claim
       INNER JOIN execution_sessions AS session ON session.id = claim.execution_session_id
       WHERE session.prompt_id = ? AND claim.claim_index = ?`,
      [input.promptId, input.claimIndex]
    );
    const claim = rows[0];
    if (!claim) {
      throw new Error(`Verification claim ${input.claimIndex} was not found for prompt ${input.promptId}`);
    }
    await this.pool.execute<ResultSetHeader>(
      `UPDATE agent_claims
       SET verdict = ?, verdict_reason_code = ?, verdict_explanation = ?,
           evidence_event_ids = ?, verification_rule_version = ?, verified_at = ?
       WHERE id = ?`,
      [
        input.verdict,
        input.reasonCode,
        input.explanation,
        JSON.stringify(input.evidence.map(value => value.eventId)),
        input.ruleVersion,
        mysqlDateTime(input.verifiedAt),
        claim.id
      ]
    );
  }

  public async updateSessionSummary(input: UpdateVerificationSessionSummaryInput): Promise<void> {
    const executionSessionId = await this.requireSessionId(input.promptId);
    const { counts } = input.summary;
    await this.pool.execute<ResultSetHeader>(
      `UPDATE execution_sessions
       SET execution_status = ?, extraction_status = ?, verification_status = ?,
           total_claims = ?, verified_claims = ?, contradicted_claims = ?,
           unsupported_claims = ?, unverifiable_claims = ?, scored_claims = ?,
           reliability_percent = ?, coverage_percent = ?, completed_at = ?
       WHERE id = ?`,
      [
        input.executionStatus,
        input.extractionStatus,
        input.verificationStatus,
        counts.totalClaims,
        counts.verified,
        counts.contradicted,
        counts.unsupported,
        counts.unverifiable,
        input.summary.scoredClaims,
        input.summary.reliabilityPercent,
        input.summary.coveragePercent,
        mysqlDateTime(input.completedAt),
        executionSessionId
      ]
    );
  }

  public async listSessions(input: ListVerificationSessionsInput): Promise<readonly VerificationSessionSummaryRecord[]> {
    const conditions: string[] = [];
    const parameters: (string | number | Date | null)[] = [];
    if (input.startedAfter) {
      conditions.push("started_at >= ?");
      parameters.push(mysqlDateTime(input.startedAfter));
    }
    if (input.startedBefore) {
      conditions.push("started_at < ?");
      parameters.push(mysqlDateTime(input.startedBefore));
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    parameters.push(input.limit, input.offset);
    const [rows] = await this.pool.execute<SessionSummaryRow[]>(
      `SELECT session.id, session.prompt_id, result.PromptQuery AS prompt_query,
              session.external_session_id, session.run_id, session.project_name, session.project_path,
              agent_name, model_name, execution_status, extraction_status,
              verification_status, total_claims, verified_claims, contradicted_claims,
              unsupported_claims, unverifiable_claims, scored_claims,
              reliability_percent, coverage_percent, started_at, completed_at
       FROM execution_sessions AS session
       LEFT JOIN prompt_results AS result ON result.id = session.prompt_result_id
       ${where}
       ORDER BY started_at DESC, session.id DESC
       LIMIT ? OFFSET ?`,
      parameters
    );
    return rows.map(mapSessionSummary);
  }

  public async listSessionDays(input: ListVerificationSessionsInput): Promise<readonly VerificationSessionDayRecord[]> {
    const conditions: string[] = [];
    const parameters: (string | number | Date | null)[] = [];
    if (input.startedAfter) {
      conditions.push("started_at >= ?");
      parameters.push(mysqlDateTime(input.startedAfter));
    }
    if (input.startedBefore) {
      conditions.push("started_at < ?");
      parameters.push(mysqlDateTime(input.startedBefore));
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const dayParameters = [...parameters, input.limit, input.offset];
    const [dayRows] = await this.pool.execute<SessionDayRow[]>(
      `SELECT DATE_FORMAT(started_at, '%Y-%m-%d') AS session_date,
              COUNT(*) AS queries,
              COALESCE(SUM(total_claims), 0) AS total_claims,
              COALESCE(SUM(verified_claims), 0) AS verified_claims,
              COALESCE(SUM(contradicted_claims), 0) AS contradicted_claims,
              COALESCE(SUM(unsupported_claims), 0) AS unsupported_claims,
              COALESCE(SUM(unverifiable_claims), 0) AS unverifiable_claims,
              COALESCE(SUM(scored_claims), 0) AS scored_claims
       FROM execution_sessions ${where}
       GROUP BY DATE_FORMAT(started_at, '%Y-%m-%d')
       ORDER BY session_date DESC
       LIMIT ? OFFSET ?`,
      dayParameters
    );
    if (dayRows.length === 0) return [];

    const dates = dayRows.map(row => row.session_date);
    const placeholders = dates.map(() => "?").join(", ");
    const sessionConditions = [
      ...conditions,
      `DATE_FORMAT(started_at, '%Y-%m-%d') IN (${placeholders})`
    ];
    const [sessionRows] = await this.pool.execute<SessionSummaryRow[]>(
      `SELECT session.id, session.prompt_id, result.PromptQuery AS prompt_query,
              session.external_session_id, session.run_id, session.project_name, session.project_path,
              agent_name, model_name, execution_status, extraction_status,
              verification_status, total_claims, verified_claims, contradicted_claims,
              unsupported_claims, unverifiable_claims, scored_claims,
              reliability_percent, coverage_percent, started_at, completed_at
       FROM execution_sessions AS session
       LEFT JOIN prompt_results AS result ON result.id = session.prompt_result_id
       WHERE ${sessionConditions.join(" AND ")}
       ORDER BY started_at DESC, session.id DESC`,
      [...parameters, ...dates]
    );
    const sessionsByDate = new Map<string, VerificationSessionSummaryRecord[]>();
    for (const row of sessionRows) {
      const session = mapSessionSummary(row);
      const date = session.startedAt.slice(0, 10);
      const sessions = sessionsByDate.get(date) ?? [];
      sessions.push(session);
      sessionsByDate.set(date, sessions);
    }

    return dayRows.map(row => {
      const totalClaims = integerValue(row.total_claims);
      const verifiedClaims = integerValue(row.verified_claims);
      const scoredClaims = integerValue(row.scored_claims);
      return {
        date: row.session_date,
        queries: integerValue(row.queries),
        totalClaims,
        verifiedClaims,
        contradictedClaims: integerValue(row.contradicted_claims),
        unsupportedClaims: integerValue(row.unsupported_claims),
        unverifiableClaims: integerValue(row.unverifiable_claims),
        reliabilityPercent: scoredClaims === 0 ? null : roundPercent(verifiedClaims / scoredClaims),
        sessions: sessionsByDate.get(row.session_date) ?? []
      };
    });
  }

  public async getSessionDetails(promptId: string): Promise<VerificationSessionDetails | null> {
    const [sessionRows] = await this.pool.execute<SessionSummaryRow[]>(
      `SELECT session.id, session.prompt_id, result.PromptQuery AS prompt_query,
              session.external_session_id, session.run_id, session.project_name, session.project_path,
              agent_name, model_name, execution_status, extraction_status,
              verification_status, total_claims, verified_claims, contradicted_claims,
              unsupported_claims, unverifiable_claims, scored_claims,
              reliability_percent, coverage_percent, started_at, completed_at
       FROM execution_sessions AS session
       LEFT JOIN prompt_results AS result ON result.id = session.prompt_result_id
       WHERE session.prompt_id = ?`,
      [promptId]
    );
    const sessionRow = sessionRows[0];
    if (!sessionRow) return null;
    const [claimRows] = await this.pool.execute<ClaimRecordRow[]>(
      `SELECT claim_index, claim_text, claim_type, target, expected_result,
              verdict, verdict_reason_code, verdict_explanation, evidence_event_ids,
              extractor_model, extraction_prompt_version, verification_rule_version,
              verified_at
       FROM agent_claims
       WHERE execution_session_id = ?
       ORDER BY claim_index ASC`,
      [sessionRow.id]
    );
    const [eventRows] = await this.pool.execute<TraceEventRecordRow[]>(
      `SELECT id, source_event_id, sequence_number, event_type, outcome, occurred_at,
              target, tool_name, file_path, command_text, working_directory, exit_code,
              test_passed, test_failed, test_skipped, file_existed_before,
              file_exists_after, file_hash_before, file_hash_after, output_hash,
              previous_event_hash, event_hash, metadata_json
       FROM trace_events
       WHERE execution_session_id = ?
       ORDER BY sequence_number ASC`,
      [sessionRow.id]
    );
    return {
      session: mapSessionSummary(sessionRow),
      claims: claimRows.map(mapClaimRecord),
      traceEvents: eventRows.map(mapTraceEventRecord)
    };
  }

  public async getOverview(input: Pick<ListVerificationSessionsInput, "startedAfter" | "startedBefore">): Promise<VerificationOverviewRecord> {
    const conditions: string[] = [];
    const parameters: (string | number | Date | null)[] = [];
    if (input.startedAfter) {
      conditions.push("started_at >= ?");
      parameters.push(mysqlDateTime(input.startedAfter));
    }
    if (input.startedBefore) {
      conditions.push("started_at < ?");
      parameters.push(mysqlDateTime(input.startedBefore));
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await this.pool.execute<OverviewRow[]>(
      `SELECT COUNT(*) AS total_sessions,
              COALESCE(SUM(total_claims), 0) AS total_claims,
              COALESCE(SUM(verified_claims), 0) AS verified_claims,
              COALESCE(SUM(contradicted_claims), 0) AS contradicted_claims,
              COALESCE(SUM(unsupported_claims), 0) AS unsupported_claims,
              COALESCE(SUM(unverifiable_claims), 0) AS unverifiable_claims,
              COALESCE(SUM(scored_claims), 0) AS scored_claims
       FROM execution_sessions ${where}`,
      parameters
    );
    const row = rows[0];
    const totalClaims = integerValue(row?.total_claims);
    const verifiedClaims = integerValue(row?.verified_claims);
    const contradictedClaims = integerValue(row?.contradicted_claims);
    const unsupportedClaims = integerValue(row?.unsupported_claims);
    const unverifiableClaims = integerValue(row?.unverifiable_claims);
    const scoredClaims = integerValue(row?.scored_claims);
    return {
      totalSessions: integerValue(row?.total_sessions),
      totalClaims,
      verifiedClaims,
      contradictedClaims,
      unsupportedClaims,
      unverifiableClaims,
      scoredClaims,
      reliabilityPercent: scoredClaims === 0 ? null : roundPercent(verifiedClaims / scoredClaims),
      coveragePercent: totalClaims === 0 ? null : roundPercent(scoredClaims / totalClaims)
    };
  }

  private async requireSessionId(promptId: string): Promise<number> {
    const [rows] = await this.pool.execute<SessionIdRow[]>(
      "SELECT id FROM execution_sessions WHERE prompt_id = ?",
      [promptId]
    );
    const row = rows[0];
    if (!row) throw sessionNotFound(promptId);
    return row.id;
  }
}

async function lockExecutionSession(connection: PoolConnection, promptId: string): Promise<number> {
  const [rows] = await connection.execute<SessionIdRow[]>(
    "SELECT id FROM execution_sessions WHERE prompt_id = ? FOR UPDATE",
    [promptId]
  );
  const row = rows[0];
  if (!row) throw sessionNotFound(promptId);
  return row.id;
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
    executionStatus: row.execution_status,
    extractionStatus: row.extraction_status,
    verificationStatus: row.verification_status,
    totalClaims: integerValue(row.total_claims),
    verifiedClaims: integerValue(row.verified_claims),
    contradictedClaims: integerValue(row.contradicted_claims),
    unsupportedClaims: integerValue(row.unsupported_claims),
    unverifiableClaims: integerValue(row.unverifiable_claims),
    scoredClaims: integerValue(row.scored_claims),
    reliabilityPercent: decimalValue(row.reliability_percent),
    coveragePercent: decimalValue(row.coverage_percent),
    startedAt: toIso(row.started_at)!,
    completedAt: toIso(row.completed_at)
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
    verifiedAt: toIso(row.verified_at)
  };
}

function mapTraceEventRecord(row: TraceEventRecordRow): VerificationTraceEventRecord {
  if (!isTraceEventType(row.event_type)) throw new Error(`Unknown persisted event type: ${row.event_type}`);
  if (!isTraceEventOutcome(row.outcome)) throw new Error(`Unknown persisted event outcome: ${row.outcome}`);
  return {
    id: row.id,
    eventId: row.source_event_id,
    sequenceNumber: row.sequence_number,
    eventType: row.event_type,
    outcome: row.outcome,
    occurredAt: toIso(row.occurred_at)!,
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
  if (!isTraceEventType(row.event_type)) throw new Error(`Unknown persisted event type: ${row.event_type}`);
  if (!isTraceEventOutcome(row.outcome)) throw new Error(`Unknown persisted event outcome: ${row.outcome}`);
  const metadata: Record<string, unknown> = { ...jsonObject(row.metadata_json) };
  assignIfPresent(metadata, "toolName", row.tool_name);
  assignIfPresent(metadata, "filePath", row.file_path);
  assignIfPresent(metadata, "command", row.command_text);
  assignIfPresent(metadata, "workingDirectory", row.working_directory);
  assignIfPresent(metadata, "exitCode", row.exit_code);
  assignIfPresent(metadata, "passed", row.test_passed);
  assignIfPresent(metadata, "failed", row.test_failed);
  assignIfPresent(metadata, "skipped", row.test_skipped);
  assignIfPresent(metadata, "fileExistedBefore", booleanValue(row.file_existed_before));
  assignIfPresent(metadata, "fileExistsAfter", booleanValue(row.file_exists_after));
  assignIfPresent(metadata, "fileHashBefore", row.file_hash_before);
  assignIfPresent(metadata, "fileHashAfter", row.file_hash_after);
  assignIfPresent(metadata, "outputHash", row.output_hash);
  return {
    promptId,
    eventId: row.source_event_id,
    sequenceNumber: row.sequence_number,
    eventType: row.event_type,
    outcome: row.outcome,
    occurredAt: toIso(row.occurred_at)!,
    ...(row.target ? { target: row.target } : {}),
    metadata
  };
}

function assignIfPresent(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== null && value !== undefined) target[key] = value;
}

function integerValue(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function decimalValue(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundPercent(value: number): number {
  return Math.round(value * 1000) / 10;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function booleanValue(value: number | boolean | null): boolean | null {
  if (value === null) return null;
  return typeof value === "boolean" ? value : value !== 0;
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = decodeJson(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Readonly<Record<string, unknown>> : {};
}

function stringArray(value: unknown): readonly string[] {
  const parsed = decodeJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function decodeJson(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return parseJson(value.toString("utf8"));
  if (typeof value === "string") return parseJson(value);
  return value;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

async function findExistingEvent(
  connection: PoolConnection,
  executionSessionId: number,
  sourceEventId: string
): Promise<ExistingEventRow | undefined> {
  const [rows] = await connection.execute<ExistingEventRow[]>(
    `SELECT id, sequence_number, event_hash
     FROM trace_events
     WHERE execution_session_id = ? AND source_event_id = ?`,
    [executionSessionId, sourceEventId]
  );
  return rows[0];
}

async function findLastEvent(
  connection: PoolConnection,
  executionSessionId: number
): Promise<LastEventRow | undefined> {
  const [rows] = await connection.execute<LastEventRow[]>(
    `SELECT sequence_number, event_hash
     FROM trace_events
     WHERE execution_session_id = ?
     ORDER BY sequence_number DESC
     LIMIT 1`,
    [executionSessionId]
  );
  return rows[0];
}

async function rollbackQuietly(connection: PoolConnection): Promise<void> {
  try {
    await connection.rollback();
  } catch {
    // Preserve the original transaction failure; the connection is released next.
  }
}

function sessionNotFound(promptId: string): Error {
  return new Error(`Verification session was not found for prompt ${promptId}`);
}

function mysqlDateTime(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid ISO-8601 timestamp: ${value}`);
  return date;
}
