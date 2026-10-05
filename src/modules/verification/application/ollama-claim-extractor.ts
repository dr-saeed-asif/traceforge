import { buildClaimExtractionPrompt, expectationFor, extractTargetAndExpectedResult, parseExtractedClaims, type ClaimExtractionRequest, type ClaimExtractor, type ExtractionResult } from "./claim-extractor.js";
import { CLAIM_TYPES, isClaimType } from "../domain/claim-types.js";
import type { ExtractedClaim } from "../domain/contracts.js";

export interface OllamaClaimExtractorOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

const text = { type: "string", minLength: 1, maxLength: 2000 };
const count = { type: "integer", minimum: 0 };
export const CLAIM_SCHEMA = {
  type: "object", additionalProperties: false, required: ["claims"],
  properties: { claims: { type: "array", maxItems: 100, items: {
    type: "object", additionalProperties: false,
    required: ["claimText", "sourceQuote", "claimType", "target", "expectedResult", "expectation"],
    properties: {
      claimText: text, sourceQuote: text, target: text, expectedResult: text,
      claimType: { type: "string", enum: CLAIM_TYPES },
      expectation: { type: "object", additionalProperties: false, required: ["outcome", "basis"], properties: {
        outcome: { enum: ["success", "failure"] }, basis: { enum: ["operation", "behavior", "unverifiable"] },
        passed: count, failed: count, skipped: count, paths: { type: "array", items: text, maxItems: 100 },
      } },
    },
  } } },
};

/** Local extraction only. Neither evidence nor verdicts are sent to the model. */
export class OllamaClaimExtractor implements ClaimExtractor {
  public readonly modelName: string;
  constructor(private readonly options: OllamaClaimExtractorOptions) {
    const url = new URL(options.endpoint);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw new Error("Ollama extraction requires a loopback HTTP endpoint");
    this.modelName = options.model;
  }
  async extract(request: ClaimExtractionRequest) { return (await this.extractDetailed(request)).claims; }
  async extractDetailed(request: ClaimExtractionRequest): Promise<ExtractionResult> {
    if (request.finalResponse.length > 24000) throw new Error("Final response exceeds the local extraction context budget");
    const started = Date.now();
    const response = await (this.options.fetchImplementation ?? fetch)(this.options.endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.options.model, stream: false, think: false, format: CLAIM_SCHEMA,
        options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 4096 }, keep_alive: "5m",
        messages: [
          { role: "system", content: buildClaimExtractionPrompt("") + '\n\nCRITICAL: The example above shows ONLY the JSON format. DO NOT copy the example values. You MUST extract REAL claims from the user message. Every claimText and sourceQuote MUST be an exact substring of the user message. Return ONLY the JSON object.' },
          { role: "user", content: request.finalResponse },
        ],
      }), signal: AbortSignal.timeout(this.options.timeoutMs ?? 180000),
    });
    if (!response.ok) throw new Error(`Local extraction failed (HTTP ${response.status})`);
    const body = await response.json() as { done?: boolean; done_reason?: string; message?: { content?: string }; model?: string; prompt_eval_count?: number; eval_count?: number };
    if (!body.done || body.done_reason === "length" || typeof body.message?.content !== "string")
      throw new Error("Local extraction returned incomplete output");
    const parsed = JSON.parse(body.message.content) as { claims?: unknown };
    let claims: readonly ExtractedClaim[];
    try {
      claims = parseExtractedClaims(normalizeClaims(parsed.claims, request.finalResponse), request.finalResponse);
    } catch (error) {
      claims = await this.repair(request.finalResponse, body.message.content, error);
    }
    return { claims, metadata: { provider: "ollama", model: body.model ?? this.modelName, latencyMs: Date.now() - started,
      temperature: 0, seed: 42, usage: { input_tokens: body.prompt_eval_count ?? 0, output_tokens: body.eval_count ?? 0 } } };
  }

  private async repair(finalResponse: string, rejectedOutput: string, cause: unknown) {
    const response = await (this.options.fetchImplementation ?? fetch)(this.options.endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.options.model, stream: false, think: false, format: CLAIM_SCHEMA,
        options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 4096 },
        messages: [{ role: "system", content: "Return only {\"claims\":[...]}. Correct the rejected JSON. Every claimText and sourceQuote must be an exact substring of FINAL RESPONSE. DO NOT use example values from the prompt. Extract REAL claims from the final response. Exclude future plans, opinions, and statements you cannot quote exactly." },
          { role: "user", content: `FINAL RESPONSE:\n${finalResponse}\n\nREJECTED JSON:\n${rejectedOutput}` }],
      }), signal: AbortSignal.timeout(this.options.timeoutMs ?? 180000),
    });
    if (!response.ok) throw new Error(`Local extraction repair failed (HTTP ${response.status})`, { cause });
    const body = await response.json() as { done?: boolean; message?: { content?: string } };
    if (!body.done || typeof body.message?.content !== "string") throw new Error("Local extraction repair returned incomplete output", { cause });
    return parseExtractedClaims(normalizeClaims((JSON.parse(body.message.content) as { claims?: unknown }).claims, finalResponse), finalResponse);
  }
}

/** Source quotes are authoritative; all non-quoted fields are locally derived. */
function normalizeClaims(value: unknown, finalResponse: string): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const sourceQuote = (candidate as Record<string, unknown>).sourceQuote;
    const claimType = (candidate as Record<string, unknown>).claimType;
    if (typeof sourceQuote !== "string" || !finalResponse.includes(sourceQuote) || !isClaimType(claimType)) return candidate;
    const details = extractTargetAndExpectedResult(sourceQuote, claimType);
    return { ...candidate, claimText: sourceQuote, target: details.target, expectedResult: details.expectedResult,
      expectation: expectationFor(sourceQuote, claimType) };
  });
}
