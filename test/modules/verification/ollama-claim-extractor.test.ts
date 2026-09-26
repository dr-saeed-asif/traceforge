import { describe, expect, it, vi } from "vitest";
import { OllamaClaimExtractor } from "../../../src/modules/verification/index.js";

describe("Ollama claim extractor", () => {
  it("uses deterministic local JSON extraction and validates grounded claims", async () => {
    const finalResponse = "Five tests passed.";
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({
      model: "qwen3.5:4b", done: true, done_reason: "stop",
      message: { content: JSON.stringify({ claims: [{
        claimText: finalResponse, sourceQuote: finalResponse, claimType: "TEST_PASSED",
        target: "test execution", expectedResult: "passed equals 5 and failed equals 0",
        expectation: { outcome: "success", basis: "operation", passed: 5, failed: 0 },
      }] }) }, prompt_eval_count: 10, eval_count: 20,
    }), { status: 200 }));
    const extractor = new OllamaClaimExtractor({
      endpoint: "http://127.0.0.1:11434/api/chat", model: "qwen3.5:4b", fetchImplementation,
    });

    const result = await extractor.extractDetailed({ finalResponse, modelName: "agent" });
    expect(result.claims).toHaveLength(1);
    expect(result.metadata).toMatchObject({ provider: "ollama", model: "qwen3.5:4b", temperature: 0, seed: 42 });
    expect(JSON.parse(String((fetchImplementation.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      model: "qwen3.5:4b", stream: false, think: false, options: { temperature: 0, seed: 42 },
    });
  });

  it("refuses a non-loopback endpoint", () => {
    expect(() => new OllamaClaimExtractor({ endpoint: "https://example.test/api/chat", model: "model" })).toThrow(/loopback/i);
  });
});
