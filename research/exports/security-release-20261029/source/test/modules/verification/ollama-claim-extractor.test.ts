import { describe, expect, it, vi } from "vitest";
import { OllamaClaimExtractor } from "../../../src/modules/verification/index.js";

describe("Ollama claim extractor", () => {
  it.each([
    { response: "All 13 tests passed.", quote: "All 13 tests passed", type: "TEST_PASSED", basis: "operation" },
    { response: "`node --check service.js` passed without output.", quote: "node --check service.js", type: "COMMAND_SUCCEEDED", basis: "operation" },
    { response: "Fixed the bug in handler.py.", quote: "Fixed the bug in handler.py", type: "FILE_MODIFIED", basis: "behavior" },
    { response: "The service should work now.", quote: "The service should work now", type: "TASK_COMPLETED", basis: "unverifiable" },
  ])("anchors a partial quote and derives literal expectation: $response", async ({ response, quote, type, basis }) => {
    const extractor = new OllamaClaimExtractor({ endpoint: "http://127.0.0.1:11434/api/chat", model: "fixture", fetchImplementation: vi.fn(async () => new Response(JSON.stringify({ done: true, message: { content: JSON.stringify({ claims: [{ claimText: quote, sourceQuote: quote, claimType: type, target: "model target", expectedResult: "model result", expectation: { outcome: "success", basis: "behavior" } }] }) } }))) });
    const result = await extractor.extractDetailed({ finalResponse: response, modelName: "agent" });
    expect(result.claims[0]).toMatchObject({ sourceQuote: response, claimText: response, claimType: type, expectation: { basis } });
  });

  it("keeps an ambiguous quote from absorbing another assertion", async () => {
    const quote = "All tests passed";
    const extractor = new OllamaClaimExtractor({ endpoint: "http://127.0.0.1:11434/api/chat", model: "fixture", fetchImplementation: vi.fn(async () => new Response(JSON.stringify({ done: true, message: { content: JSON.stringify({ claims: [{ claimText: quote, sourceQuote: quote, claimType: "TEST_PASSED", target: "test execution", expectedResult: "passed", expectation: { outcome: "success", basis: "operation" } }] }) } }))) });
    const result = await extractor.extractDetailed({ finalResponse: "All tests passed yesterday. All tests passed today.", modelName: "agent" });
    expect(result.claims[0]?.sourceQuote).toBe(quote);
  });
  it("accounts for both generation and repair tokens when exact-quote fallback is used", async () => {
    const responses=[{done:true,message:{content:'{"claims":"invalid"}'},prompt_eval_count:10,eval_count:20}, {done:true,message:{content:'{"claims":"still invalid"}'},prompt_eval_count:7,eval_count:8}];
    const extractor=new OllamaClaimExtractor({endpoint:"http://127.0.0.1:11434/api/chat",model:"fixture",fetchImplementation:vi.fn(async()=>new Response(JSON.stringify(responses.shift()),{status:200}))});
    const result=await extractor.extractDetailed({finalResponse:"All 5 tests passed.",modelName:"agent"});
    expect(result.metadata).toMatchObject({attemptCount:2,repairCount:1,fallback:"exact-quote-heuristic",outcome:"FALLBACK",usage:{input_tokens:17,output_tokens:28}});
    expect(result.claims).toHaveLength(1);
  });
  it("retains failed-attempt telemetry instead of silently substituting a verdict", async()=>{
    const extractor=new OllamaClaimExtractor({endpoint:"http://127.0.0.1:11434/api/chat",model:"fixture",fetchImplementation:vi.fn(async()=>new Response("unavailable",{status:503}))});
    await expect(extractor.extractDetailed({finalResponse:"Tests passed.",modelName:"agent"})).rejects.toMatchObject({extractionMetadata:{outcome:"FAILED",attemptCount:1,attempts:[expect.objectContaining({httpStatus:503,status:"FAILED"})]}});
  });
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
