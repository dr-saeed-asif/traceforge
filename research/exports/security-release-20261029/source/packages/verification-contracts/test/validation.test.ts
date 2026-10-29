import { describe, expect, it } from "vitest";
import {
  ContractValidationError,
  parseVerificationOverviewResponse,
  parseVerificationSessionDetailsResponse,
  parseVerificationSessionsResponse,
} from "../src/index.js";

const session = {
  promptId: "prompt-1",
  promptQuery: "Create the requested file",
  externalSessionId: "session-1",
  runId: "run-1",
  projectName: "TraceForge",
  projectPath: "H:/TraceForge",
  agentName: "builder",
  modelName: "test-model",
  executionStatus: "COMPLETED",
  extractionStatus: "SUCCEEDED",
  verificationStatus: "SUCCEEDED",
  totalClaims: 1,
  verifiedClaims: 1,
  contradictedClaims: 0,
  unsupportedClaims: 0,
  unverifiableClaims: 0,
  scoredClaims: 1,
  reliabilityPercent: 100,
  coveragePercent: 100,
  startedAt: "2026-09-21T10:00:00.000Z",
  completedAt: "2026-09-21T10:00:10.000Z",
};

const overviewResponse = {
  overview: {
    totalSessions: 1,
    totalClaims: 1,
    verifiedClaims: 1,
    contradictedClaims: 0,
    unsupportedClaims: 0,
    unverifiableClaims: 0,
    scoredClaims: 1,
    reliabilityPercent: 100,
    coveragePercent: 100,
  },
  sessions: [session],
  pagination: { limit: 10, offset: 0, returned: 1 },
  additiveFutureField: true,
};

const detailsResponse = {
  session,
  claims: [
    {
      claimIndex: 1,
      claimText: "The file was created",
      claimType: "FILE_CREATED",
      target: "src/app.ts",
      expectedResult: "target exists after the change",
      verdict: "VERIFIED",
      reasonCode: "REQUIRED_EVIDENCE_CONFIRMED",
      explanation: "The file exists.",
      evidenceEventIds: ["event-1"],
      extractorModel: "test-model",
      extractionPromptVersion: "1.0.0",
      verificationRuleVersion: "2.0.0",
      verifiedAt: "2026-09-21T10:00:10.000Z",
    },
  ],
  traceEvents: [
    {
      id: 1,
      eventId: "event-1",
      sequenceNumber: 1,
      eventType: "FILE_CREATED",
      outcome: "SUCCEEDED",
      occurredAt: "2026-09-21T10:00:01.000Z",
      target: "src/app.ts",
      toolName: "write",
      filePath: "src/app.ts",
      command: null,
      workingDirectory: null,
      exitCode: null,
      testPassed: null,
      testFailed: null,
      testSkipped: null,
      fileExistedBefore: false,
      fileExistsAfter: true,
      fileHashBefore: null,
      fileHashAfter: "b".repeat(64),
      outputHash: null,
      previousEventHash: null,
      eventHash: "c".repeat(64),
      metadata: { filePath: "src/app.ts", nested: [true, 1, null] },
    },
  ],
};

describe("verification response contracts", () => {
  it("parses valid overview responses while allowing additive fields", () => {
    const parsed = parseVerificationOverviewResponse(overviewResponse);

    expect(parsed.overview.reliabilityPercent).toBe(100);
    expect(parsed.sessions[0]?.promptId).toBe("prompt-1");
    expect(parsed).not.toHaveProperty("additiveFutureField");
  });

  it("keeps session-list responses compatible when hasMore is absent", () => {
    const parsed = parseVerificationSessionsResponse({
      sessions: [session],
      pagination: { limit: 10, offset: 0, returned: 1 },
    });

    expect(parsed.pagination.hasMore).toBe(false);
  });

  it("rejects inconsistent counters with a useful response path", () => {
    const invalid = structuredClone(overviewResponse);
    invalid.overview.totalClaims = 2;

    expect(() => parseVerificationOverviewResponse(invalid)).toThrow(
      ContractValidationError,
    );
    expect(() => parseVerificationOverviewResponse(invalid)).toThrow(
      "$response.overview",
    );
  });

  it("parses detail evidence and rejects dangling evidence references", () => {
    const parsed = parseVerificationSessionDetailsResponse(detailsResponse);
    expect(parsed.traceEvents[0]?.metadata).toEqual({
      filePath: "src/app.ts",
      nested: [true, 1, null],
    });

    const invalid = structuredClone(detailsResponse);
    invalid.claims[0]!.evidenceEventIds = ["missing-event"];
    expect(() => parseVerificationSessionDetailsResponse(invalid)).toThrow(
      "references unknown evidence event",
    );
  });

  it("rejects malformed hashes and unordered trace events", () => {
    const invalidHash = structuredClone(detailsResponse);
    invalidHash.traceEvents[0]!.eventHash = "not-a-hash";
    expect(() => parseVerificationSessionDetailsResponse(invalidHash)).toThrow(
      "expected a lowercase SHA-256 hash",
    );

    const unordered = structuredClone(detailsResponse);
    unordered.traceEvents.push({
      ...unordered.traceEvents[0]!,
      id: 2,
      eventId: "event-2",
      sequenceNumber: 1,
    });
    expect(() => parseVerificationSessionDetailsResponse(unordered)).toThrow(
      "strictly increasing sequenceNumber",
    );
  });
});
