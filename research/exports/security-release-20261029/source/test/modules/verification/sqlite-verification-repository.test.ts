import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteDatabase } from "../../../src/infrastructure/sqlite/sqlite-database.js";
import { applySqliteMigrations } from "../../../src/infrastructure/sqlite/sqlite-migrator.js";
import { SqlitePromptResultRepository } from "../../../src/infrastructure/sqlite/sqlite-prompt-result-repository.js";
import { SqliteVerificationRepository } from "../../../src/modules/verification/index.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("SqliteVerificationRepository", () => {
  it("persists an idempotent hash-chained prompt and returns the stable read model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "traceforge-sqlite-"));
    cleanup.push(directory);
    const database = openSqliteDatabase(join(directory, "traceforge.sqlite"));
    await applySqliteMigrations(database);
    const prompts = new SqlitePromptResultRepository(database);
    const verification = new SqliteVerificationRepository(database);

    try {
      await verification.createSession({
        promptId: "prompt-sqlite",
        externalSessionId: "session-sqlite",
        runId: "run-sqlite",
        promptResultId: null,
        projectName: "fixture",
        projectPath: "H:/fixture",
        agentName: "OpenCode",
        modelName: "test-model",
        policyVersion: "2.0.0",
        startedAt: "2026-09-22T10:00:00.000Z"
      });
      const eventInput = {
        promptId: "prompt-sqlite",
        externalSessionId: "session-sqlite",
        runId: "run-sqlite",
        sourceEventId: "event-test",
        eventType: "TEST_COMPLETED" as const,
        outcome: "SUCCEEDED" as const,
        occurredAt: "2026-09-22T10:00:01.000Z",
        target: "npm test",
        metadata: { command: "npm test", exitCode: 0, passed: 2, failed: 0 },
        projections: { command: "npm test", exitCode: 0, testPassed: 2, testFailed: 0 }
      };
      const inserted = await verification.appendTraceEvent(eventInput);
      const duplicate = await verification.appendTraceEvent(eventInput);
      expect(inserted).toMatchObject({ sequenceNumber: 1, deduplicated: false });
      expect(duplicate).toMatchObject({ sequenceNumber: 1, deduplicated: true, eventHash: inserted.eventHash });

      const promptResultId = await prompts.save({
        promptId: "prompt-sqlite",
        sessionId: "session-sqlite",
        runId: "run-sqlite",
        projectName: "fixture",
        projectPath: "H:/fixture",
        status: "COMPLETED",
        promptQuery: "Run tests",
        agentName: "OpenCode",
        modelName: "test-model",
        result: "All tests passed",
        resources: [],
        filePaths: [],
        generatedCode: [],
        encryptedGeneratedCode: {
          version: 1,
          algorithm: "aes-256-gcm",
          iv: "fixture",
          authTag: "fixture",
          ciphertext: "fixture"
        },
        gitUser: "NOT_AVAILABLE"
      });
      await verification.attachPromptResult("prompt-sqlite", promptResultId);
      await verification.saveExtractedClaim({
        promptId: "prompt-sqlite",
        claimIndex: 1,
        claimText: "All tests passed",
        claimType: "TEST_PASSED",
        target: "npm test",
        expectedResult: "exitCode equals 0 and failed equals 0",
        extractorModel: "test-model",
        extractionPromptVersion: "1.0.0",
        verificationRuleVersion: "2.1.0"
      });
      await verification.saveClaimVerification({
        promptId: "prompt-sqlite",
        claimIndex: 1,
        verdict: "VERIFIED",
        reasonCode: "REQUIRED_EVIDENCE_CONFIRMED",
        explanation: "The latest test completed successfully.",
        evidence: [{ eventId: "event-test", sequenceNumber: 1, eventType: "TEST_COMPLETED" }],
        ruleVersion: "2.1.0",
        verifiedAt: "2026-09-22T10:00:02.000Z"
      });
      await verification.updateSessionSummary({
        processingMetrics: {
          extractorModel: "local-extractor", extractionStartedAt: "2026-09-22T10:00:02.000Z",
          extractionCompletedAt: "2026-09-22T10:00:03.000Z", extractionDurationMs: 1000,
          verificationStartedAt: "2026-09-22T10:00:03.000Z",
          verificationCompletedAt: "2026-09-22T10:00:03.020Z", verificationDurationMs: 20,
        },
        promptId: "prompt-sqlite",
        executionStatus: "COMPLETED",
        extractionStatus: "SUCCEEDED",
        verificationStatus: "SUCCEEDED",
        summary: {
          counts: { totalClaims: 1, verified: 1, contradicted: 0, unsupported: 0, unverifiable: 0 },
          scoredClaims: 1,
          reliabilityPercent: 100,
          coveragePercent: 100
        },
        completedAt: "2026-09-22T10:00:02.000Z"
      });

      const details = await verification.getSessionDetails("prompt-sqlite");
      expect(details?.session.processingMetrics).toMatchObject({ extractorModel: "local-extractor", extractionDurationMs: 1000, verificationDurationMs: 20 });
      expect(details?.session).toMatchObject({ promptQuery: "Run tests", reliabilityPercent: 100 });
      expect(details?.claims[0]).toMatchObject({ verdict: "VERIFIED", evidenceEventIds: ["event-test"] });
      expect(details?.traceEvents).toHaveLength(1);
      expect(details?.traceEvents[0]).toMatchObject({ testPassed: 2, testFailed: 0 });
      expect(await verification.getOverview({})).toMatchObject({ totalSessions: 1, verifiedClaims: 1, reliabilityPercent: 100 });
      expect(await verification.listSessionDays({ limit: 10, offset: 0 })).toMatchObject([
        { date: "2026-09-22", queries: 1, reliabilityPercent: 100 }
      ]);
      expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
