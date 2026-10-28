import { describe, expect, it } from "vitest";
import {
  classifyClaimType,
  extractClaims,
} from "../../../src/modules/verification/application/claim-extractor.js";
import { verifyClaim } from "../../../src/modules/verification/application/claim-verifier.js";
import type {
  ExtractedClaim,
  VerificationEvidence,
} from "../../../src/modules/verification/domain/contracts.js";

/** Regression tests for the round-1 review findings (T2, T5, T12, freshness). */
const base = {
  promptId: "p",
  occurredAt: "2026-01-01T00:00:00.000Z",
} as const;

function fileCreated(seq: number, path: string): VerificationEvidence {
  return {
    ...base,
    eventId: `f${seq}`,
    sequenceNumber: seq,
    eventType: "FILE_CREATED",
    outcome: "SUCCEEDED",
    target: path,
    metadata: { fileExistedBefore: false, fileExistsAfter: true, fileHashAfter: "h" },
  };
}

function testRun(
  seq: number,
  command: string,
  metadata: Record<string, unknown> = {},
): VerificationEvidence {
  return {
    ...base,
    eventId: `t${seq}`,
    sequenceNumber: seq,
    eventType: "TEST_COMPLETED",
    outcome: "SUCCEEDED",
    target: command,
    metadata: { exitCode: 0, passed: 6, failed: 0, ...metadata },
  };
}

function claim(partial: Partial<ExtractedClaim> & Pick<ExtractedClaim, "claimType" | "target">): ExtractedClaim {
  return {
    claimIndex: 1,
    claimText: partial.claimText ?? "claim",
    expectedResult: partial.expectedResult ?? "",
    ...partial,
  };
}

describe("T2: strict target matching", () => {
  it("does not verify a file claim with a different file's creation", () => {
    const result = verifyClaim(
      claim({ claimType: "FILE_CREATED", target: "src/auth/login.ts" }),
      [fileCreated(1, "src/app.ts")],
    );
    expect(result.verdict).toBe("UNSUPPORTED");
  });

  it("accepts a claimed relative path that is a whole-segment suffix", () => {
    const result = verifyClaim(
      claim({ claimType: "FILE_CREATED", target: "app.ts" }),
      [fileCreated(1, "src/app.ts")],
    );
    expect(result.verdict).toBe("VERIFIED");
    const partial = verifyClaim(
      claim({ claimType: "FILE_CREATED", target: "pp.ts" }),
      [fileCreated(1, "src/app.ts")],
    );
    expect(partial.verdict).toBe("UNSUPPORTED");
  });

  it("does not verify a test claim with an unrelated test command", () => {
    const result = verifyClaim(
      claim({ claimType: "TEST_PASSED", target: "npm run test:auth" }),
      [testRun(1, "node --test search.test.cjs")],
    );
    expect(result.verdict).toBe("UNSUPPORTED");
  });

  it("matches a command inside an && chain and a whole-argument test path", () => {
    expect(
      verifyClaim(claim({ claimType: "TEST_PASSED", target: "npm test" }), [
        testRun(1, "cd app && npm test -- --run"),
      ]).verdict,
    ).toBe("VERIFIED");
    expect(
      verifyClaim(claim({ claimType: "TEST_PASSED", target: "search.test.cjs" }), [
        testRun(1, "node --test search.test.cjs"),
      ]).verdict,
    ).toBe("VERIFIED");
  });

  it("treats an empty target as unsupported rather than matching everything", () => {
    expect(
      verifyClaim(claim({ claimType: "FILE_MODIFIED", target: "" }), [fileCreated(1, "x.ts")]).verdict,
    ).toBe("UNSUPPORTED");
  });
});

describe("T12: classifier order", () => {
  it.each([
    ["`node --check search.cjs` passed without output", "COMMAND_SUCCEEDED"],
    ["The build passed", "BUILD_PASSED"],
    ["npm run build completed successfully", "BUILD_PASSED"],
    ["All 6 tests passed", "TEST_PASSED"],
    ["`node --test search.test.cjs`: 6 passed", "TEST_PASSED"],
  ])("%s -> %s", (statement, expected) => {
    expect(classifyClaimType(statement)).toBe(expected);
  });
});

describe("freshness at claim time", () => {
  it("rejects a test whose own invocation changed workspace files", () => {
    const result = verifyClaim(
      claim({ claimType: "TEST_PASSED", target: "npm test" }),
      [testRun(1, "npm test && sed -i s/a/b/ src/app.ts", { changedPaths: ["src/app.ts"] })],
    );
    expect(result).toMatchObject({ verdict: "UNSUPPORTED", reasonCode: "EVIDENCE_IS_STALE" });
  });

  it("rejects freshness when workspace observation was incomplete", () => {
    const result = verifyClaim(
      claim({ claimType: "TEST_PASSED", target: "npm test" }),
      [testRun(1, "npm test", { workspaceObservation: "incomplete" })],
    );
    expect(result).toMatchObject({ verdict: "UNSUPPORTED", reasonCode: "EVIDENCE_IS_INVALID" });
  });

  it("flags test-file edits before a passing run without hiding the verdict", () => {
    const edit: VerificationEvidence = {
      ...base,
      eventId: "e1",
      sequenceNumber: 1,
      eventType: "FILE_MODIFIED",
      outcome: "SUCCEEDED",
      target: "test/search.test.cjs",
      metadata: { fileExistedBefore: true, fileExistsAfter: true, fileHashBefore: "a", fileHashAfter: "b" },
    };
    const result = verifyClaim(claim({ claimType: "TEST_PASSED", target: "npm test" }), [
      edit,
      testRun(2, "npm test"),
    ]);
    expect(result.verdict).toBe("VERIFIED");
    expect(result.explanation).toContain("Advisory");
    expect(result.evidence.map((value) => value.eventId)).toContain("e1");
  });
});

describe("T5: hedged and descriptive claims stay visible", () => {
  it("keeps a hedged completion statement as an UNVERIFIABLE claim", () => {
    const claims = extractClaims("Everything should be working now.");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.claimType).toBe("TASK_COMPLETED");
    expect(claims[0]!.expectation?.basis).toBe("unverifiable");
    expect(verifyClaim(claims[0]!, []).verdict).toBe("UNVERIFIABLE");
  });

  it("still drops future plans", () => {
    expect(extractClaims("I will run the tests next.")).toHaveLength(0);
  });

  it("does not verify a structure claim that names no checkable path", () => {
    const result = verifyClaim(
      claim({ claimType: "STRUCTURE_CREATED", target: "project", expectedResult: "the structure exists" }),
      [fileCreated(1, "src/app.ts")],
    );
    expect(result.verdict).toBe("UNSUPPORTED");
  });
});
