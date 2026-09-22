import { describe, expect, it } from "vitest";
import {
  buildClaimExtractionPrompt,
  extractClaims,
  parseExtractedClaims,
  splitAtomicStatements
} from "../../../src/modules/verification/index.js";

describe("claim extractor", () => {
  it("splits combined final responses into objective atomic claims", () => {
    const claims = extractClaims("Email validation added and all tests passed. The UI looks clean and should be improved later.");

    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({ claimType: "FILE_MODIFIED", target: "email validation" });
    expect(claims[1]).toMatchObject({ claimType: "TEST_PASSED", target: "test execution" });
    expect(claims.map(value => value.claimIndex)).toEqual([1, 2]);
  });

  it("recognizes Urdu conjunctions without turning subjective text into claims", () => {
    const statements = splitAtomicStatements("Email validation add kar di hai aur tamam tests pass hain.");
    expect(statements).toEqual(["Email validation add kar di hai", "tamam tests pass hain."]);
    expect(extractClaims("Email validation add kar di hai aur tamam tests pass hain.")).toHaveLength(2);
  });

  it("validates model-shaped JSON before persistence", () => {
    expect(parseExtractedClaims([{ claimText: "Build passed", claimType: "BUILD_PASSED", target: "npm run build", expectedResult: "exitCode equals 0" }])).toEqual([
      { claimIndex: 1, claimText: "Build passed", claimType: "BUILD_PASSED", target: "npm run build", expectedResult: "exitCode equals 0" }
    ]);
    expect(() => parseExtractedClaims([{ claimText: "bad", claimType: "UNKNOWN", target: "x", expectedResult: "y" }])).toThrow(/invalid extracted claim/i);
  });

  it("recognizes path-based file creation and command success claims", () => {
    expect(extractClaims("Created src/validation.ts. npm install succeeded.")).toMatchObject([
      { claimType: "FILE_CREATED", target: "src/validation.ts" },
      { claimType: "COMMAND_SUCCEEDED", target: "npm install" }
    ]);
  });

  it("provides a verdict-free model prompt", () => {
    const prompt = buildClaimExtractionPrompt("All tests passed");
    expect(prompt).toContain("Return JSON only");
    expect(prompt).toContain("All tests passed");
    expect(prompt).not.toContain("VERIFIED");
  });
});
