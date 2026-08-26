import { describe, expect, it } from "vitest";
import { RedactionPolicy } from "../src/index.js";

describe("RedactionPolicy", () => {
  it("removes common secrets before persistence", () => {
    const input = [
      "Authorization: Bearer top-secret-token",
      "password=hunter2",
      "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv",
      "postgres://admin:secret@localhost/prod"
    ].join("\n");

    const result = new RedactionPolicy().redact(input);
    expect(result.value).not.toContain("top-secret-token");
    expect(result.value).not.toContain("hunter2");
    expect(result.value).not.toContain("sk-abcdefghijklmnopqrstuv");
    expect(result.value).not.toContain("admin:secret");
    expect(result.redactionCount).toBeGreaterThanOrEqual(4);
  });

  it("supports configurable rules", () => {
    const policy = new RedactionPolicy([{ name: "tenant-id", pattern: /tenant-\d+/gu }]);
    expect(policy.redact("use tenant-123").value).toBe("use [REDACTED]");
  });
});
