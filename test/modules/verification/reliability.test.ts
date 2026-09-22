import { describe, expect, it } from "vitest";
import { calculateReliabilitySummary } from "../../../src/modules/verification/index.js";

describe("calculateReliabilitySummary", () => {
  it("reproduces the document's mixed-verdict daily example", () => {
    const summary = calculateReliabilitySummary([
      "VERIFIED",
      "VERIFIED",
      "VERIFIED",
      "VERIFIED",
      "VERIFIED",
      "VERIFIED",
      "CONTRADICTED",
      "CONTRADICTED",
      "UNSUPPORTED",
      "UNVERIFIABLE"
    ]);

    expect(summary.scoredClaims).toBe(9);
    expect(summary.reliabilityPercent).toBe(66.7);
    expect(summary.coveragePercent).toBe(90);
  });

  it("excludes unverifiable claims from the reliability denominator", () => {
    const summary = calculateReliabilitySummary(["VERIFIED", "UNSUPPORTED", "UNVERIFIABLE"]);

    expect(summary.reliabilityPercent).toBe(50);
    expect(summary.coveragePercent).toBe(66.7);
  });

  it("returns null reliability when no objective claim can be scored", () => {
    const summary = calculateReliabilitySummary(["UNVERIFIABLE"]);

    expect(summary.reliabilityPercent).toBeNull();
    expect(summary.coveragePercent).toBe(0);
  });

  it("returns null percentages when there are no extracted claims", () => {
    const summary = calculateReliabilitySummary([]);

    expect(summary.reliabilityPercent).toBeNull();
    expect(summary.coveragePercent).toBeNull();
  });
});
