import { describe, expect, it, vi } from "vitest";
import { MysqlVerificationRepository } from "../../../src/modules/verification/index.js";

const event = {
  promptId: "prompt-1",
  externalSessionId: "session-1",
  runId: "run-1",
  sourceEventId: "source-event-1",
  eventType: "FILE_MODIFIED" as const,
  outcome: "SUCCEEDED" as const,
  occurredAt: "2026-09-19T12:00:00.000Z",
  target: "src/app.ts",
  metadata: { filePath: "src/app.ts" },
  projections: {
    filePath: "src/app.ts",
    fileExistedBefore: true,
    fileExistsAfter: true,
    fileHashBefore: "a".repeat(64),
    fileHashAfter: "b".repeat(64)
  }
};

describe("MysqlVerificationRepository appendTraceEvent", () => {
  it("serializes a new event under the execution-session lock", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 17 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 91, affectedRows: 1 }, []]);
    const connection = transactionConnection(execute);
    const repository = new MysqlVerificationRepository({
      getConnection: vi.fn(async () => connection)
    } as never);

    const result = await repository.appendTraceEvent(event);

    expect(result).toMatchObject({ traceEventId: 91, sequenceNumber: 1, deduplicated: false });
    expect(result.eventHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("returns an existing event without extending the hash chain", async () => {
    const existingHash = "c".repeat(64);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 17 }], []])
      .mockResolvedValueOnce([[{ id: 91, sequence_number: 4, event_hash: existingHash }], []]);
    const connection = transactionConnection(execute);
    const repository = new MysqlVerificationRepository({
      getConnection: vi.fn(async () => connection)
    } as never);

    const result = await repository.appendTraceEvent(event);

    expect(result).toEqual({
      traceEventId: 91,
      sequenceNumber: 4,
      eventHash: existingHash,
      deduplicated: true
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the connection when the session is missing", async () => {
    const execute = vi.fn().mockResolvedValueOnce([[], []]);
    const connection = transactionConnection(execute);
    const repository = new MysqlVerificationRepository({
      getConnection: vi.fn(async () => connection)
    } as never);

    await expect(repository.appendTraceEvent(event)).rejects.toThrow(
      "Verification session was not found for prompt prompt-1"
    );
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});

describe("MysqlVerificationRepository verification reads", () => {
  it("loads verifier evidence through the prompt boundary and restores typed projections", async () => {
    const execute = vi.fn(async () => [[{
      id: 91,
      source_event_id: "test-1",
      sequence_number: 7,
      event_type: "TEST_COMPLETED",
      outcome: "SUCCEEDED",
      occurred_at: "2026-09-20T10:00:01.000Z",
      target: "npm test",
      tool_name: "bash",
      file_path: null,
      command_text: "npm test",
      working_directory: "H:/TraceForge",
      exit_code: 0,
      test_passed: 12,
      test_failed: 0,
      test_skipped: 1,
      file_existed_before: null,
      file_exists_after: null,
      file_hash_before: null,
      file_hash_after: null,
      output_hash: "a".repeat(64),
      previous_event_hash: "b".repeat(64),
      event_hash: "c".repeat(64),
      metadata_json: JSON.stringify({ outputTruncated: true })
    }], []] as const);
    const repository = new MysqlVerificationRepository({ execute } as never);

    const evidence = await repository.loadVerificationEvidence("prompt-1");

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("WHERE session.prompt_id = ?"), ["prompt-1"]);
    expect(evidence[0]).toMatchObject({
      promptId: "prompt-1",
      eventId: "test-1",
      sequenceNumber: 7,
      metadata: { command: "npm test", exitCode: 0, passed: 12, failed: 0, skipped: 1 }
    });
  });

  it("maps paginated session summaries and date-window parameters", async () => {
    const execute = vi.fn(async () => [[{
      id: 17,
      prompt_id: "prompt-1",
      prompt_query: "Create the requested file",
      external_session_id: "session-1",
      run_id: "run-1",
      project_name: "TraceForge",
      project_path: "H:/TraceForge",
      agent_name: "builder",
      model_name: "test-model",
      execution_status: "COMPLETED",
      extraction_status: "SUCCEEDED",
      verification_status: "SUCCEEDED",
      total_claims: "2",
      verified_claims: "1",
      contradicted_claims: "0",
      unsupported_claims: "1",
      unverifiable_claims: "0",
      scored_claims: "2",
      reliability_percent: "50.00",
      coverage_percent: "100.00",
      started_at: "2026-09-20T10:00:00.000Z",
      completed_at: "2026-09-20T10:00:02.000Z"
    }], []] as const);
    const repository = new MysqlVerificationRepository({ execute } as never);

    const sessions = await repository.listSessions({
      limit: 10,
      offset: 20,
      startedAfter: "2026-09-01T00:00:00.000Z",
      startedBefore: "2026-10-01T00:00:00.000Z"
    });

    expect(sessions[0]).toMatchObject({
      promptId: "prompt-1",
      promptQuery: "Create the requested file",
      totalClaims: 2,
      reliabilityPercent: 50
    });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("ORDER BY started_at DESC"), expect.any(Array));
    expect((execute.mock.calls[0]?.[1] as unknown[]).slice(-2)).toEqual([10, 20]);
  });

  it("returns typed claim and trace-event details for a prompt", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([[{
        id: 17,
        prompt_id: "prompt-1",
        prompt_query: "Create the requested file",
        external_session_id: "session-1",
        run_id: "run-1",
        project_name: null,
        project_path: null,
        agent_name: "builder",
        model_name: "test-model",
        execution_status: "COMPLETED",
        extraction_status: "SUCCEEDED",
        verification_status: "SUCCEEDED",
        total_claims: 1,
        verified_claims: 1,
        contradicted_claims: 0,
        unsupported_claims: 0,
        unverifiable_claims: 0,
        scored_claims: 1,
        reliability_percent: 100,
        coverage_percent: 100,
        started_at: "2026-09-20T10:00:00.000Z",
        completed_at: "2026-09-20T10:00:02.000Z"
      }], []])
      .mockResolvedValueOnce([[{
        claim_index: 1,
        claim_text: "The file was created",
        claim_type: "FILE_CREATED",
        target: "src/app.ts",
        expected_result: "file exists",
        verdict: "VERIFIED",
        verdict_reason_code: "REQUIRED_EVIDENCE_CONFIRMED",
        verdict_explanation: "confirmed",
        evidence_event_ids: JSON.stringify(["event-1"]),
        extractor_model: "test-model",
        extraction_prompt_version: "1.0.0",
        verification_rule_version: "1.0.0",
        verified_at: "2026-09-20T10:00:02.000Z"
      }], []])
      .mockResolvedValueOnce([[{
        id: 91,
        source_event_id: "event-1",
        sequence_number: 1,
        event_type: "FILE_CREATED",
        outcome: "SUCCEEDED",
        occurred_at: "2026-09-20T10:00:01.000Z",
        target: "src/app.ts",
        tool_name: "write",
        file_path: "src/app.ts",
        command_text: null,
        working_directory: null,
        exit_code: null,
        test_passed: null,
        test_failed: null,
        test_skipped: null,
        file_existed_before: 0,
        file_exists_after: 1,
        file_hash_before: null,
        file_hash_after: "b".repeat(64),
        output_hash: null,
        previous_event_hash: null,
        event_hash: "c".repeat(64),
        metadata_json: JSON.stringify({ filePath: "src/app.ts" })
      }], []]);
    const repository = new MysqlVerificationRepository({ execute } as never);

    const details = await repository.getSessionDetails("prompt-1");
    expect(details?.claims[0]).toMatchObject({ verdict: "VERIFIED", evidenceEventIds: ["event-1"] });
    expect(details?.traceEvents[0]).toMatchObject({ eventId: "event-1", fileExistsAfter: true });
  });
});

function transactionConnection(execute: ReturnType<typeof vi.fn>) {
  return {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    execute
  };
}
