import { classifyClaimType, expectationFor, extractClaims, extractTargetAndExpectedResult, isHedgedAssertion, parseExtractedClaims, splitAtomicStatements, type ClaimExtractionRequest, type ClaimExtractor, type ExtractionResult } from "./claim-extractor.js";
import { CLAIM_TYPES, isClaimType } from "../domain/claim-types.js";
import type { ExtractedClaim } from "../domain/contracts.js";

export interface OllamaClaimExtractorOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMs?: number;
  /** Requested provider context; configure to the locally supported capacity. */
  readonly contextTokens?: number;
  readonly fetchImplementation?: typeof fetch;
}

const text = { type: "string", minLength: 1, maxLength: 2000 };
export const CLAIM_SCHEMA = {
  type: "object", additionalProperties: false, required: ["claims"],
  properties: { claims: { type: "array", maxItems: 100, items: {
    type: "object", additionalProperties: false,
    required: ["sourceQuote", "claimType"],
    properties: {
      sourceQuote: text,
      claimType: { type: "string", enum: CLAIM_TYPES },
    },
  } } },
};

export class ClaimExtractionFailure extends Error {
  constructor(message: string, public readonly extractionMetadata: Readonly<Record<string, unknown>>) { super(message); }
}

/** Attempt telemetry includes repairs and failures, without persisting request/response content. */
export class OllamaClaimExtractor implements ClaimExtractor {
  public readonly modelName: string;
  constructor(private readonly options: OllamaClaimExtractorOptions) {
    const url = new URL(options.endpoint);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Ollama extraction requires a loopback HTTP endpoint");
    this.modelName = options.model;
    if (options.contextTokens !== undefined && (!Number.isSafeInteger(options.contextTokens) || options.contextTokens < 1024)) throw new Error("contextTokens must be an integer of at least 1024");
  }
  async extract(request: ClaimExtractionRequest) { return (await this.extractDetailed(request)).claims; }
  async extractDetailed(request: ClaimExtractionRequest): Promise<ExtractionResult> {
    const started = performance.now();
    const attempts: Record<string, unknown>[] = [];
    let fallback = false;
    const metadata = () => ({ provider: "ollama", model: this.modelName, latencyMs: Math.round(performance.now() - started),
      temperature: 0, seed: 42, contextTokens: this.options.contextTokens ?? 8192, timeoutMs: this.options.timeoutMs ?? 180000,
      attemptCount: attempts.length, repairCount: attempts.filter(a => a.stage === "repair").length,
      fallback: fallback ? "exact-quote-heuristic" : null, attempts,
      usage: { input_tokens: attempts.reduce((n,a) => n + Number(a.inputTokens ?? 0), 0), output_tokens: attempts.reduce((n,a) => n + Number(a.outputTokens ?? 0), 0) }
    });
    const call = async (stage: string, messages: {role:string;content:string}[]) => {
      const attemptStart = performance.now();
      const attempt: Record<string, unknown> = { stage, startedAt: new Date().toISOString(), status: "PENDING" };
      attempts.push(attempt);
      try {
        const response = await (this.options.fetchImplementation ?? fetch)(this.options.endpoint, {
          method: "POST", headers: {"content-type":"application/json"},
          body: JSON.stringify({model:this.modelName,stream:false,think:false,format:CLAIM_SCHEMA,
            options:{temperature:0,seed:42,num_ctx:this.options.contextTokens ?? 8192,num_predict:4096},keep_alive:"5m",messages}),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 180000)
        });
        attempt.httpStatus = response.status;
        if (!response.ok) throw new Error(`Local extraction failed (HTTP ${response.status})`);
        const body = await response.json() as {done?:boolean;done_reason?:string;model?:string;message?:{content?:string};prompt_eval_count?:number;eval_count?:number;load_duration?:number;eval_duration?:number;total_duration?:number};
        Object.assign(attempt, {model:body.model ?? this.modelName,inputTokens:body.prompt_eval_count ?? 0,outputTokens:body.eval_count ?? 0,
          loadDurationMs:typeof body.load_duration === "number" ? body.load_duration / 1e6 : null,
          generationDurationMs:typeof body.eval_duration === "number" ? body.eval_duration / 1e6 : null,
          providerDurationMs:typeof body.total_duration === "number" ? body.total_duration / 1e6 : null});
        if (!body.done || body.done_reason === "length" || typeof body.message?.content !== "string") throw new Error("Local extraction returned incomplete output");
        attempt.status = "SUCCEEDED";
        return body.message.content;
      } catch (error) { attempt.status = "FAILED"; attempt.error = error instanceof Error ? error.message : "request failed"; throw error; }
      finally {attempt.latencyMs = Math.round(performance.now() - attemptStart);}
    };
    try {
      if (request.finalResponse.length > 24000) throw new Error("Final response exceeds the local extraction context budget");
      const initial = await call("initial", [
        {role:"system",content:[
          "Extract every factual software-engineering assertion from the supplied final response.",
          "Return {\"claims\":[{\"sourceQuote\":\"exact full atomic assertion\",\"claimType\":\"TYPE\"}]} only.",
          "Quote each whole assertion including its verb, negation, counts, qualifiers and punctuation; a command or filename alone is not an assertion.",
          "Split compound assertions, exclude future plans and opinions, and retain hedged current-state assertions as TASK_COMPLETED.",
          `Allowed types: ${CLAIM_TYPES.join(", ")}. Syntax checks are COMMAND_SUCCEEDED, builds BUILD_PASSED, and tests TEST_PASSED.`,
          "Do not evaluate correctness or evidence. Targets, expectations and verdicts are determined separately."
        ].join("\n")},
        {role:"user",content:request.finalResponse}
      ]);
      const parse = (raw:string) => parseExtractedClaims(normalizeClaims((JSON.parse(raw) as {claims?:unknown}).claims,request.finalResponse),request.finalResponse);
      let claims: readonly ExtractedClaim[];
      try { claims = parse(initial); }
      catch {
        attempts[0]!.validation = "FAILED";
        try {
          const repaired = await call("repair", [
            {role:"system",content:"Return only corrected {\"claims\":[{\"sourceQuote\":\"exact full assertion from FINAL RESPONSE\",\"claimType\":\"TYPE\"}]}. Exclude future plans and opinions."},
            {role:"user",content:`FINAL RESPONSE:\n${request.finalResponse}\nREJECTED JSON:\n${initial}`}
          ]);
          claims = parse(repaired);
        } catch (error) {
          attempts[attempts.length - 1]!.validation = "FAILED";
          claims = extractClaims(request.finalResponse);
          if (claims.length === 0) throw error;
          fallback = true;
        }
      }
      if (claims.length === 0) {
        const exact = extractClaims(request.finalResponse);
        if (exact.length > 0) {claims = exact; fallback = true;}
      }
      return {claims,metadata:{...metadata(),outcome: fallback ? "FALLBACK" : claims.length ? "SUCCEEDED" : "SUCCESSFUL_EMPTY"}};
    } catch (error) { throw new ClaimExtractionFailure(error instanceof Error ? error.message : "Extraction failed", {...metadata(),outcome:"FAILED"}); }
  }
}

/** Source quotes are authoritative; all non-quoted fields are locally derived. */
function normalizeClaims(value: unknown, finalResponse: string): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const sourceQuote = (candidate as Record<string, unknown>).sourceQuote;
    const modelClaimType = (candidate as Record<string, unknown>).claimType;
    if (typeof sourceQuote !== "string" || !sourceQuote.trim() || !finalResponse.includes(sourceQuote) || !isClaimType(modelClaimType)) return candidate;
    // Models often return a command or a sentence without its final punctuation.
    // Anchor to a unique atomic statement in the supplied response, preserving
    // its negation, counts and qualifiers. Ambiguous fragments stay unchanged.
    // No evidence, gold labels or evaluation matching rules participate here.
    const spans = [...new Set(splitAtomicStatements(finalResponse))]
      .filter(span => finalResponse.includes(span) && span.includes(sourceQuote));
    const quote = spans.length === 1 ? spans[0]! : sourceQuote;
    // The model can confuse a passing test run with a passing build. Prefer the
    // locally inferred type whenever the exact quoted statement is recognizable.
    const recognizedType = isHedgedAssertion(quote) ? "TASK_COMPLETED" : classifyClaimType(quote);
    const claimType = recognizedType ?? modelClaimType;
    const details = extractTargetAndExpectedResult(quote, claimType);
    const local = expectationFor(quote, claimType);
    const rank = { operation: 0, behavior: 1, unverifiable: 2 } as const;
    const modelBasis = ((candidate as Record<string, unknown>).expectation as { basis?: unknown } | undefined)?.basis;
    // For locally recognized assertions, basis is a policy decision about the
    // literal statement. A model's unsupported "behavior" tag must not turn
    // an observable test result into UNVERIFIABLE. Local semantic/hedged checks
    // still protect "fixed the bug" and "should work" from being verified.
    const basis = !recognizedType && typeof modelBasis === "string" && modelBasis in rank && rank[modelBasis as keyof typeof rank] > rank[local.basis]
      ? (modelBasis as keyof typeof rank) : local.basis;
    return { ...candidate, claimText: quote, sourceQuote: quote, claimType, target: details.target, expectedResult: details.expectedResult,
      expectation: { ...local, basis } };
  });
}
