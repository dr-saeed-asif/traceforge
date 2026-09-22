import { describe, expect, it } from "vitest";
import {
  CLAIM_TYPES,
  CLAIM_VERIFICATION_POLICIES,
  getClaimVerificationPolicy
} from "../../../src/modules/verification/index.js";

describe("claim verification policy", () => {
  it("defines exactly one policy for every supported claim type", () => {
    expect(Object.keys(CLAIM_VERIFICATION_POLICIES).sort()).toEqual([...CLAIM_TYPES].sort());
  });

  it("maps test claims to completed test evidence", () => {
    expect(getClaimVerificationPolicy("TEST_PASSED")).toMatchObject({
      strategy: "EVENT_EVIDENCE",
      candidateEventTypes: ["TEST_COMPLETED"]
    });
  });

  it("requires aggregate verification for task-completion claims", () => {
    expect(getClaimVerificationPolicy("TASK_COMPLETED")).toMatchObject({
      strategy: "AGGREGATE_CLAIMS",
      candidateEventTypes: []
    });
  });
});
