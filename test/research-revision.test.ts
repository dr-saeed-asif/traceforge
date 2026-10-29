import { afterEach, expect, it, vi } from "vitest";
import { modelJudge } from "../src/research/baselines.js";
import { verifyClaim, verifyClaims } from "../src/modules/verification/application/claim-verifier.js";
import type { ExtractedClaim, VerificationEvidence } from "../src/modules/verification/domain/contracts.js";

afterEach(() => vi.unstubAllGlobals());

it("strips gold verdicts, rationales and annotation metadata before either judge sees an oracle claim", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ done: true, message: { content: '{"verdict":"UNSUPPORTED","reason":"no evidence","requestEventIds":[]}' } })));
  vi.stubGlobal("fetch", fetchMock);
  const claim = { claimIndex: 1, claimText: "Created widget.ts.", claimType: "FILE_CREATED" as const, target: "widget.ts", expectedResult: "exists", verdict: "VERIFIED", rationale: "SECRET HUMAN LABEL", annotatorVerdicts: { a: "VERIFIED" }, evidenceEventIds: ["secret-gold-evidence"] };
  for (const agent of [false, true]) {
    await modelJudge(claim, [], { agent, model: "fixture", endpoint: "http://localhost:11434/api/chat", seed: 42, promptQuery: "Create widget.ts", finalResponse: claim.claimText });
    const request = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    const input = JSON.parse(request.messages[1].content);
    expect(input.claim).toEqual({ claimIndex: 1, claimText: claim.claimText, claimType: "FILE_CREATED", target: "widget.ts", expectedResult: "exists" });
    expect(request.messages[1].content).not.toContain("SECRET");
    expect(request.messages[1].content).not.toContain("secret-gold");
  }
});

it("batch preparation preserves individual rule decisions on unordered and future evidence", () => {
  const claims: ExtractedClaim[] = [{ claimIndex: 1, claimType: "FILE_CREATED", claimText: "Created widget.ts.", target: "widget.ts", expectedResult: "exists" }, { claimIndex: 2, claimType: "TEST_PASSED", claimText: "All 2 tests passed.", target: "test execution", expectedResult: "passed" }];
  const event = (sequenceNumber: number, eventType: VerificationEvidence["eventType"], target: string, metadata: Record<string, unknown>): VerificationEvidence => ({ promptId: "p", eventId: `e${sequenceNumber}`, sequenceNumber, eventType, target, metadata, outcome: "SUCCEEDED", occurredAt: `2026-01-01T00:00:0${sequenceNumber}.000Z` });
  const evidence = [event(4, "FILE_DELETED", "widget.ts", { fileExistsAfter: false }), event(2, "TEST_COMPLETED", "npm test", { command: "npm test", exitCode: 0, passed: 2, failed: 0 }), event(1, "FILE_CREATED", "widget.ts", { fileExistedBefore: false, fileExistsAfter: true }), event(3, "FINAL_RESPONSE_CAPTURED", "", {})];
  expect(verifyClaims(claims, evidence)).toEqual(claims.map(claim => verifyClaim(claim, evidence)));
  expect(verifyClaims(claims, evidence).map(r => r.verdict)).toEqual(["VERIFIED", "VERIFIED"]);
});
