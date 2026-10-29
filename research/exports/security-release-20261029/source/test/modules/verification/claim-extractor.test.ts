import { describe, expect, it } from "vitest";
import {
  buildClaimExtractionPrompt,
  extractClaims,
  parseExtractedClaims,
  splitAtomicStatements,
} from "../../../src/modules/verification/index.js";

describe("claim extractor", () => {
  it("splits combined final responses into objective atomic claims", () => {
    const claims = extractClaims(
      "Email validation added and all tests passed. The UI looks clean and should be improved later.",
    );

    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({
      claimType: "FILE_MODIFIED",
      target: "email validation",
    });
    expect(claims[1]).toMatchObject({
      claimType: "TEST_PASSED",
      target: "test execution",
    });
    expect(claims.map((value) => value.claimIndex)).toEqual([1, 2]);
  });

  it("recognizes Urdu conjunctions without turning subjective text into claims", () => {
    const statements = splitAtomicStatements(
      "Email validation add kar di hai aur tamam tests pass hain.",
    );
    expect(statements).toEqual([
      "Email validation add kar di hai",
      "tamam tests pass hain.",
    ]);
    expect(
      extractClaims(
        "Email validation add kar di hai aur tamam tests pass hain.",
      ),
    ).toHaveLength(2);
  });

  it("validates model-shaped JSON before persistence", () => {
    expect(
      parseExtractedClaims([
        {
          claimText: "Build passed",
          claimType: "BUILD_PASSED",
          target: "npm run build",
          expectedResult: "exitCode equals 0",
        },
      ]),
    ).toEqual([
      {
        claimIndex: 1,
        claimText: "Build passed",
        claimType: "BUILD_PASSED",
        target: "npm run build",
        expectedResult: "exitCode equals 0",
      },
    ]);
    expect(() =>
      parseExtractedClaims([
        {
          claimText: "bad",
          claimType: "UNKNOWN",
          target: "x",
          expectedResult: "y",
        },
      ]),
    ).toThrow(/invalid extracted claim/i);
  });

  it("recognizes path-based file creation and command success claims", () => {
    expect(
      extractClaims("Created src/validation.ts. npm install succeeded."),
    ).toMatchObject([
      { claimType: "FILE_CREATED", target: "src/validation.ts" },
      { claimType: "COMMAND_SUCCEEDED", target: "npm install" },
    ]);
  });

  it("provides a verdict-free model prompt", () => {
    const prompt = buildClaimExtractionPrompt("All tests passed");
    expect(prompt).toContain("Return JSON only");
    expect(prompt).toContain("All tests passed");
    expect(prompt).not.toContain("VERIFIED");
  });

  it("preserves test counts, failures, and semantic file claims", () => {
    expect(extractClaims("Five tests passed.")[0]?.expectation).toMatchObject({
      outcome: "success",
      passed: 5,
    });
    expect(extractClaims("Tests failed.")[0]?.expectation).toMatchObject({
      outcome: "failure",
    });
    expect(
      extractClaims("Email validation was added in src/validation.ts.")[0],
    ).toMatchObject({
      claimType: "FILE_MODIFIED",
      target: "src/validation.ts",
      expectation: { basis: "behavior" },
    });
  });

  it("requires model claims to quote the final response", () => {
    const response = "Five tests passed.";
    expect(
      parseExtractedClaims(
        [
          {
            claimText: response,
            sourceQuote: response,
            claimType: "TEST_PASSED",
            target: "test execution",
            expectedResult: "five tests passed",
            expectation: { outcome: "success", basis: "operation", passed: 5 },
          },
        ],
        response,
      ),
    ).toHaveLength(1);
    expect(() =>
      parseExtractedClaims(
        [
          {
            claimText: "Invented claim",
            sourceQuote: "Invented claim",
            claimType: "TEST_PASSED",
            target: "test execution",
            expectedResult: "tests pass",
            expectation: { outcome: "success", basis: "operation" },
          },
        ],
        response,
      ),
    ).toThrow(/quote/i);
  });
});
