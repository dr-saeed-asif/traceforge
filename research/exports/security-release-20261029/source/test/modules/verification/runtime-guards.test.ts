import { describe, expect, it } from "vitest";
import {
  isClaimType,
  isExecutionStatus,
  isProcessingStatus,
  isTraceEventOutcome,
  isTraceEventType,
  isVerdictReasonCode,
  isVerificationVerdict
} from "../../../src/modules/verification/index.js";

describe("verification runtime guards", () => {
  it("accepts supported contract values", () => {
    expect(isClaimType("FILE_MODIFIED")).toBe(true);
    expect(isTraceEventType("TEST_COMPLETED")).toBe(true);
    expect(isTraceEventOutcome("SUCCEEDED")).toBe(true);
    expect(isVerificationVerdict("CONTRADICTED")).toBe(true);
    expect(isVerdictReasonCode("CONTRADICTORY_EVIDENCE_FOUND")).toBe(true);
    expect(isExecutionStatus("INTERRUPTED")).toBe(true);
    expect(isProcessingStatus("PENDING")).toBe(true);
  });

  it("rejects unknown and incorrectly cased values", () => {
    expect(isClaimType("file_modified")).toBe(false);
    expect(isTraceEventType("UNKNOWN_EVENT")).toBe(false);
    expect(isTraceEventOutcome("SUCCESS")).toBe(false);
    expect(isVerificationVerdict("PENDING")).toBe(false);
    expect(isVerdictReasonCode(null)).toBe(false);
    expect(isExecutionStatus("DONE")).toBe(false);
    expect(isProcessingStatus(undefined)).toBe(false);
  });
});
