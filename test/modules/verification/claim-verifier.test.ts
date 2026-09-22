import { describe, expect, it } from "vitest";
import { verifyClaim, verifyClaims, type VerificationEvidence } from "../../../src/modules/verification/index.js";
import type { ExtractedClaim } from "../../../src/modules/verification/index.js";

const evidence: VerificationEvidence[] = [
  {
    promptId: "prompt-1",
    eventId: "file-1",
    sequenceNumber: 1,
    eventType: "FILE_MODIFIED",
    outcome: "SUCCEEDED",
    occurredAt: "2026-01-01T00:00:01.000Z",
    target: "src/validation.ts",
    metadata: { fileExistedBefore: true, fileExistsAfter: true, fileHashBefore: "a", fileHashAfter: "b" }
  },
  {
    promptId: "prompt-1",
    eventId: "tests-1",
    sequenceNumber: 2,
    eventType: "TEST_COMPLETED",
    outcome: "SUCCEEDED",
    occurredAt: "2026-01-01T00:00:02.000Z",
    target: "npm test",
    metadata: { exitCode: 0, passed: 12, failed: 0 }
  },
  {
    promptId: "prompt-1",
    eventId: "build-1",
    sequenceNumber: 3,
    eventType: "BUILD_COMPLETED",
    outcome: "FAILED",
    occurredAt: "2026-01-01T00:00:03.000Z",
    target: "npm run build",
    metadata: { exitCode: 1 }
  }
];

describe("deterministic claim verifier", () => {
  it("verifies file and test claims using typed evidence", () => {
    const claims: ExtractedClaim[] = [
      { claimIndex: 1, claimText: "Validation changed", claimType: "FILE_MODIFIED", target: "src/validation.ts", expectedResult: "target changed" },
      { claimIndex: 2, claimText: "All tests passed", claimType: "TEST_PASSED", target: "npm test", expectedResult: "exitCode equals 0 and failed equals 0" }
    ];

    expect(verifyClaims(claims, evidence).map(value => value.verdict)).toEqual(["VERIFIED", "VERIFIED"]);
    expect(verifyClaims(claims, evidence)[1]?.evidence[0]).toMatchObject({ eventId: "tests-1", eventType: "TEST_COMPLETED" });
  });

  it("contradicts a failed latest build and reports the exact evidence", () => {
    const result = verifyClaim({ claimIndex: 1, claimText: "Build passed", claimType: "BUILD_PASSED", target: "npm run build", expectedResult: "exitCode equals 0" }, evidence);
    expect(result).toMatchObject({ verdict: "CONTRADICTED", reasonCode: "CONTRADICTORY_EVIDENCE_FOUND" });
    expect(result.evidence).toEqual([{ eventId: "build-1", sequenceNumber: 3, eventType: "BUILD_COMPLETED" }]);
  });

  it("marks missing evidence unsupported and aggregate claims by child verdict", () => {
    const claims: ExtractedClaim[] = [
      { claimIndex: 1, claimText: "README updated", claimType: "FILE_MODIFIED", target: "README.md", expectedResult: "target changed" },
      { claimIndex: 2, claimText: "Task completed", claimType: "TASK_COMPLETED", target: "task", expectedResult: "all required objective claims are verified" }
    ];
    const results = verifyClaims(claims, evidence);
    expect(results.map(value => value.verdict)).toEqual(["UNSUPPORTED", "UNSUPPORTED"]);
    expect(results[0]?.reasonCode).toBe("MATCHING_EVIDENCE_NOT_FOUND");
    expect(results[1]?.reasonCode).toBe("AGGREGATE_REQUIREMENTS_NOT_MET");
  });

  it("does not accept a successful event with contradictory test counts", () => {
    const result = verifyClaim({ claimIndex: 1, claimText: "Tests passed", claimType: "TEST_PASSED", target: "npm test", expectedResult: "no failed tests" }, [{
      promptId: "prompt-1", eventId: "tests-2", sequenceNumber: 1, eventType: "TEST_COMPLETED", outcome: "SUCCEEDED", occurredAt: "2026-01-01T00:00:01.000Z", target: "npm test", metadata: { exitCode: 0, passed: 11, failed: 1 }
    }]);
    expect(result.verdict).toBe("CONTRADICTED");
  });

  it("requires every declared architecture layer for a structure claim", () => {
    const claim: ExtractedClaim = {
      claimIndex: 1,
      claimText: "Four architecture layers created",
      claimType: "STRUCTURE_CREATED",
      target: "src",
      expectedResult: "domain, application, infrastructure, presentation directories and files exist"
    };
    const events: VerificationEvidence[] = ["domain", "application", "infrastructure", "presentation"].map((layer, index) => ({
      promptId: "prompt-1",
      eventId: `layer-${layer}`,
      sequenceNumber: index + 1,
      eventType: "DIRECTORY_CREATED",
      outcome: "SUCCEEDED",
      occurredAt: `2026-01-01T00:00:0${index + 1}.000Z`,
      target: `src/${layer}`,
      metadata: {}
    }));
    expect(verifyClaim(claim, events).verdict).toBe("VERIFIED");
    expect(verifyClaim(claim, events.slice(0, 3)).verdict).toBe("UNSUPPORTED");
  });

  it("uses only evidence belonging to the requested prompt", () => {
    const claim: ExtractedClaim = { claimIndex: 1, claimText: "Tests passed", claimType: "TEST_PASSED", target: "npm test", expectedResult: "no failed tests" };
    const crossPrompt: VerificationEvidence[] = [
      { promptId: "prompt-other", eventId: "foreign-pass", sequenceNumber: 1, eventType: "TEST_COMPLETED", outcome: "SUCCEEDED", occurredAt: "2026-01-01T00:00:01.000Z", target: "npm test", metadata: { exitCode: 0, failed: 0 } },
      { promptId: "prompt-1", eventId: "local-fail", sequenceNumber: 2, eventType: "TEST_COMPLETED", outcome: "FAILED", occurredAt: "2026-01-01T00:00:02.000Z", target: "npm test", metadata: { exitCode: 1, failed: 1 } }
    ];

    const result = verifyClaim(claim, crossPrompt, [], { promptId: "prompt-1" });
    expect(result.verdict).toBe("CONTRADICTED");
    expect(result.evidence.map(value => value.eventId)).toEqual(["local-fail"]);
  });

  it("rejects a successful test result made stale by a later file change", () => {
    const claim: ExtractedClaim = { claimIndex: 1, claimText: "Tests passed", claimType: "TEST_PASSED", target: "npm test", expectedResult: "no failed tests" };
    const events: VerificationEvidence[] = [
      { promptId: "prompt-1", eventId: "tests-pass", sequenceNumber: 1, eventType: "TEST_COMPLETED", outcome: "SUCCEEDED", occurredAt: "2026-01-01T00:00:01.000Z", target: "npm test", metadata: { exitCode: 0, failed: 0 } },
      { promptId: "prompt-1", eventId: "claim", sequenceNumber: 2, eventType: "FINAL_RESPONSE_CAPTURED", outcome: "RECORDED", occurredAt: "2026-01-01T00:00:02.000Z", metadata: {} },
      { promptId: "prompt-1", eventId: "later-edit", sequenceNumber: 3, eventType: "FILE_MODIFIED", outcome: "SUCCEEDED", occurredAt: "2026-01-01T00:00:03.000Z", target: "src/app.ts", metadata: { fileExistedBefore: true, fileExistsAfter: true, fileHashBefore: "a", fileHashAfter: "b" } }
    ];

    const result = verifyClaim(claim, events, [], { promptId: "prompt-1" });
    expect(result).toMatchObject({ verdict: "UNSUPPORTED", reasonCode: "EVIDENCE_IS_STALE" });
    expect(result.evidence.map(value => value.eventId)).toEqual(["tests-pass", "later-edit"]);
    expect(result.explanation).toContain("after the claim was captured");
  });

  it("prefers direct negative evidence and marks a missing rule unverifiable", () => {
    const claim: ExtractedClaim = { claimIndex: 1, claimText: "Build passed", claimType: "BUILD_PASSED", target: "npm run build", expectedResult: "exit code 0" };
    const events: VerificationEvidence[] = [
      { promptId: "prompt-1", eventId: "build-fail", sequenceNumber: 1, eventType: "BUILD_COMPLETED", outcome: "FAILED", occurredAt: "2026-01-01T00:00:01.000Z", target: "npm run build", metadata: { exitCode: 1 } },
      { promptId: "prompt-1", eventId: "later-edit", sequenceNumber: 2, eventType: "FILE_MODIFIED", outcome: "SUCCEEDED", occurredAt: "2026-01-01T00:00:02.000Z", target: "src/app.ts", metadata: {} }
    ];

    expect(verifyClaim(claim, events, [], { promptId: "prompt-1" }).verdict).toBe("CONTRADICTED");
    expect(verifyClaim(claim, events, [], { promptId: "prompt-1", rules: {} })).toMatchObject({
      verdict: "UNVERIFIABLE",
      reasonCode: "OBJECTIVE_RULE_NOT_DEFINED"
    });
  });

  it("uses a later test rerun as the current state after an edit", () => {
    const claim: ExtractedClaim = { claimIndex: 1, claimText: "Tests passed", claimType: "TEST_PASSED", target: "npm test", expectedResult: "no failed tests" };
    const events: VerificationEvidence[] = [
      { promptId: "prompt-1", eventId: "old-pass", sequenceNumber: 1, eventType: "TEST_COMPLETED", outcome: "SUCCEEDED", occurredAt: "2026-01-01T00:00:01.000Z", target: "npm test", metadata: { exitCode: 0, failed: 0 } },
      { promptId: "prompt-1", eventId: "edit", sequenceNumber: 2, eventType: "FILE_MODIFIED", outcome: "SUCCEEDED", occurredAt: "2026-01-01T00:00:02.000Z", target: "src/app.ts", metadata: {} },
      { promptId: "prompt-1", eventId: "new-pass", sequenceNumber: 3, eventType: "TEST_COMPLETED", outcome: "SUCCEEDED", occurredAt: "2026-01-01T00:00:03.000Z", target: "npm test", metadata: { exitCode: 0, failed: 0 } }
    ];

    const result = verifyClaim(claim, events, [], { promptId: "prompt-1" });
    expect(result.verdict).toBe("VERIFIED");
    expect(result.evidence.map(value => value.eventId)).toEqual(["new-pass"]);
  });
});
