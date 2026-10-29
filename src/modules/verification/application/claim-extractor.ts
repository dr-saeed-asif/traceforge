import type { ClaimType } from "../domain/claim-types.js";
import { isClaimType } from "../domain/claim-types.js";
import type { ClaimExpectation, ExtractedClaim } from "../domain/contracts.js";

/** Versioned prompt/schema contract for a future model-backed extractor. */
export const EXTRACTION_PROMPT_VERSION = "3.3.0";

export interface ClaimExtractionRequest {
  readonly finalResponse: string;
  readonly modelName: string;
}

/** Adapter boundary for an LLM or another claim extraction implementation. */
export interface ClaimExtractor {
  readonly modelName?: string;
  extract(request: ClaimExtractionRequest): Promise<readonly ExtractedClaim[]>;
  extractDetailed?(request: ClaimExtractionRequest): Promise<ExtractionResult>;
}

export interface ExtractionResult {
  readonly claims: readonly ExtractedClaim[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Local extractor used by the default runtime. It deliberately extracts only
 * objective, evidence-shaped statements; a model adapter can implement the
 * same port later without changing verification or persistence.
 */
export class HeuristicClaimExtractor implements ClaimExtractor {
  public readonly modelName = "heuristic-v3";
  public async extract(
    request: ClaimExtractionRequest,
  ): Promise<readonly ExtractedClaim[]> {
    return extractClaims(request.finalResponse);
  }
}

/** Splits a final response into short, independently evaluable statements. */
export function splitAtomicStatements(
  finalResponse: string,
): readonly string[] {
  const normalized = finalResponse.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return [];
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .filter(Boolean);
  const statements: string[] = [];
  for (const line of lines) {
    const sentences = line
      .split(/(?<=[.!?;])\s+/u)
      .flatMap((value) => splitConjunction(value));
    statements.push(...sentences.map((value) => value.trim()).filter(Boolean));
  }
  return statements;
}

/** Removes prose that cannot be checked against captured execution evidence. */
export function removeNonVerifiableText(statement: string): string | null {
  const cleaned = statement
    .replace(
      /^\s*(?:agent(?:'s)?\s+final\s+answer|final\s+answer)\s*:\s*/iu,
      "",
    )
    .replace(/^['"“”]|['"“”]$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (isFuturePlan(cleaned)) return null;
  if (!cleaned || cleaned.length < 4 || cleaned.length > 600) return null;
  if (
    /\b(?:i think|i believe|probably|hopefully|maybe|should|will|plan to|could|might)\b/iu.test(
      cleaned,
    )
  )
    return null;
  if (
    /\b(?:great|clean|nice|good|properly|well[- ]structured|looks good)\b/iu.test(
      cleaned,
    ) &&
    !objectiveKeyword(cleaned)
  )
    return null;
  return objectiveKeyword(cleaned) ? cleaned : null;
}

/** Classifies one statement using the stable Phase 1 claim vocabulary. */
export function classifyClaimType(statement: string): ClaimType | null {
  const value = statement.toLowerCase();
  const passive=/[`"']?((?:[\w.-]+[\\/])*[\w.-]+\.[\w-]+)[`"']?\s+(?:(?:has|have)\s+been|was|were|is)\s+(created|generated|added|modified|updated|changed|edited)\b/iu.exec(value);
  if(passive)return /^(?:created|generated|added)$/iu.test(passive[2]!)?"FILE_CREATED":"FILE_MODIFIED";
  if (/\b(?:node\s+(?:--check|-c)\b|syntax[ -]check|py_compile|tsc\s+--noemit)\b/iu.test(value) && /\b(?:pass(?:ed)?|success(?:ful)?|succeeded|exit|completed)\b/iu.test(value)) return "COMMAND_SUCCEEDED";
  // Policy 2.1.0: builds are classified before tests, and a TEST claim needs a
  // test noun or a recognised test command; the word "passed" alone is not
  // enough (e.g. "`node --check x.cjs` passed" is a command claim).
  if (
    /\b(?:build|builds|compiled|compile|compilation)\b/iu.test(value) &&
    !/\b(?:tests?|specs?|suites?)\b/iu.test(value) &&
    /\b(?:pass|passed|success|successful|succeeded|complete|completed|done|zero\s+errors?)\b/iu.test(
      value,
    )
  )
    return "BUILD_PASSED";
  if (
    (/\b(?:tests?|specs?|suites?)\b/iu.test(value) ||
      /(?:\bnode\b[^\n]*\s--test\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b|\b(?:vitest|jest|pytest|phpunit)\b|\b(?:cargo|go)\s+test\b)/iu.test(
        value,
      )) &&
    /\b(?:pass|passed|passing|success|successful|succeeded|complete|completed|run|ran|runs|failed|fail|failing)\b/iu.test(
      value,
    )
  )
    return "TEST_PASSED";
  if (
    /\b(?:dependenc\w*|import\s+graph|forbidden\s+import|architecture\s+rule|layers?\s+(?:are|were)\s+separat\w*)\b/iu.test(
      value,
    ) &&
    /\b(?:separat\w*|pass|passed|success|successful|valid\w*|no\s+forbidden)\b/iu.test(
      value,
    )
  )
    return "DEPENDENCY_RULE";
  if (
    /\b(?:architecture|layers?|directories?|folders?|structure)\b/iu.test(
      value,
    ) &&
    /\b(?:create[ds]?|added|built|setup|set\s+up|organized|exist|implemented)\b/iu.test(
      value,
    )
  )
    return "STRUCTURE_CREATED";
  if (
    /(?:\b(?:command|ran|run|executed|exit\s*code|exitcode)\b|\b(?:npm|pnpm|yarn|npx|node|pytest|vitest|jest|cargo|go)\s+[\w:.-]+)/iu.test(
      value,
    ) &&
    ( /\b(?:success|successful|succeeded|passed|complete|completed|zero)\b/iu.test(value) ||
      /\bexit(?:ed)?\s+(?:with\s+)?(?:code\s*)?0\b/iu.test(value) )
  )
    return "COMMAND_SUCCEEDED";
  if (
    /\b(?:new\s+file|file\s+(?:was\s+)?(?:created|added|generated)|created\s+(?:a\s+)?(?:new\s+)?file|added\s+(?:a\s+)?(?:new\s+)?file)\b/iu.test(
      value,
    ) ||
    /\b(?:created|generated|added)\s+[`"']?(?:[\w.-]+[\\/])*[\w.-]+\.[\w-]+\b/iu.test(value) ||
    /^(?:i\s+)?(?:created|generated|added)\s+[`"']?(?:[\w.-]+[\\/])+[\w.-]+/iu.test(
      value,
    )
  )
    return "FILE_CREATED";
  if (
    /\b(?:file|code|readme|package(?:\.json)?|config|manifest|validation|component|page|function|feature|implementation|bug|error)\b/iu.test(
      value,
    ) &&
    /\b(?:modif|updated|changed|edited|fixed|implemented|add|added|applied|created)\w*\b/iu.test(
      value,
    )
  )
    return "FILE_MODIFIED";
  if (
    /(?:(?:task|request|work|implementation|feature|query|project)\b[^.]{0,80}\b(?:done|completed|finished|implemented)\b|\b(?:task|request|work|implementation|feature|query|project)\s+(?:is|was)\s+(?:done|completed|finished))/iu.test(
      value,
    )
  )
    return "TASK_COMPLETED";
  if (
    /\b(?:structure|architecture)\b.*\b(?:clean|good|proper)\b|\bcontains\s+\d+\s+files\b/iu.test(
      value,
    )
  )
    return "TASK_COMPLETED";
  return isBehaviorAssertion(value)?"TASK_COMPLETED":null;
}

/** Extracts target and objective expectation for a classified statement. */
export function extractTargetAndExpectedResult(
  statement: string,
  claimType: ClaimType,
): { readonly target: string; readonly expectedResult: string } {
  const explicitPath =
    /`([^`]+)`/u.exec(statement)?.[1] ??
    /[`"']?((?:[\w.-]+[\\/])*[\w.-]+\.[\w-]+)[`"']?\s+(?:(?:has|have)\s+been|was|were|is)\s+(?:created|generated|added|modified|updated|changed|edited)\b/iu.exec(statement)?.[1] ??
    /\b(?:src|app|packages|tests?|test|lib|infrastructure|docs)(?:[\\/][\w.*-]+)+(?:\.[\w-]+)?/iu.exec(
      statement,
    )?.[0] ??
    /\b(?:README(?:\.md)?|package\.json|[\w-]+\.(?:ts|js|tsx|jsx|py|md|json))\b/iu.exec(
      statement,
    )?.[0];
  const command = /\b(?:npm|pnpm|yarn|npx|node|python3?|pytest|vitest|jest|phpunit|cargo|go|tsc)\s+[^`\n]+/iu.exec(statement)?.[0]
    ?.split(/\s+(?:passed|failed|succeeded|successfully|completed|with|and|returned|exited)\b/iu)[0]?.trim();
  const quotedCommand = /`([^`]+)`/u.exec(statement)?.[1];
  const fullCommand = quotedCommand && /^(?:npm|pnpm|yarn|npx|node|python3?|pytest|vitest|jest|phpunit|cargo|go|tsc)\b/u.test(quotedCommand.trim()) ? quotedCommand.trim() : undefined;
  const target =
    (["BUILD_PASSED", "TEST_PASSED", "COMMAND_SUCCEEDED"].includes(claimType) ? (fullCommand ?? (command?cleanCommandTarget(command):undefined)) : undefined) ??
    explicitPath?.trim().replace(/[.,;:!?]+$/u, "") ??
    (claimType === "BUILD_PASSED" ||
    claimType === "TEST_PASSED" ||
    claimType === "COMMAND_SUCCEEDED"
      ? (command ??
        (claimType === "BUILD_PASSED"
          ? "build"
          : claimType === "TEST_PASSED"
            ? "test execution"
            : "command execution"))
      : claimType === "DEPENDENCY_RULE"
        ? "project import graph"
        : claimType === "STRUCTURE_CREATED"
          ? firstStructureTarget(statement)
          : claimType === "TASK_COMPLETED"
            ? "task"
            : semanticTarget(statement, claimType));
  const expectedResult = {
    FILE_CREATED: "target exists after the change",
    FILE_MODIFIED: "target changed to the claimed implementation",
    STRUCTURE_CREATED: structureExpectation(statement),
    DEPENDENCY_RULE: "dependency rule passes without forbidden imports",
    COMMAND_SUCCEEDED: "matching command exits with code 0",
    BUILD_PASSED: "exitCode equals 0",
    TEST_PASSED: "exitCode equals 0 and failed equals 0",
    TASK_COMPLETED: "all required objective claims are verified",
  } satisfies Record<ClaimType, string>;
  return { target, expectedResult: expectedResult[claimType] };
}

function cleanCommandTarget(value:string):string {
  let result=value.replace(/[.,;:!?]+$/u,"");
  while(result.endsWith(")")&&(result.match(/\)/gu)?.length??0)>(result.match(/\(/gu)?.length??0))result=result.slice(0,-1).trimEnd();
  return result;
}

/** Extracts and validates the stable claim records persisted in AgentClaim. */
export function extractClaims(
  finalResponse: string,
): readonly ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();
  for (const rawStatement of splitAtomicStatements(finalResponse)) {
    const hedged = hedgedCompletionStatement(rawStatement);
    const statement = hedged ?? removeNonVerifiableText(rawStatement);
    if (!statement) continue;
    const claimType = hedged ? "TASK_COMPLETED" : classifyClaimType(statement);
    if (!claimType) continue;
    const details = extractTargetAndExpectedResult(statement, claimType);
    const key = `${claimType}|${details.target.toLowerCase()}|${statement.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({
      claimIndex: claims.length + 1,
      claimText: statement,
      claimType,
      target: details.target,
      expectedResult: details.expectedResult,
      sourceQuote: statement,
      expectation: expectationFor(statement, claimType),
    });
  }
  return claims;
}

/** Validates model JSON before it is allowed to reach persistence. */
export function parseExtractedClaims(
  value: unknown,
  finalResponse?: string,
): readonly ExtractedClaim[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new TypeError(
      "Claim extraction response must be an array of at most 100 claims",
    );
  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    if (
      !isRecord(candidate) ||
      !isClaimType(candidate.claimType) ||
      !nonEmpty(candidate.claimText) ||
      !nonEmpty(candidate.target) ||
      !nonEmpty(candidate.expectedResult)
    ) {
      throw new TypeError(`Invalid extracted claim at index ${index}`);
    }
    if (
      [candidate.claimText, candidate.target, candidate.expectedResult].some(
        (text) => text.length > 2000,
      )
    )
      throw new TypeError("Claim fields are too long");
    if (
      finalResponse !== undefined &&
      (!nonEmpty(candidate.sourceQuote) ||
        !finalResponse.includes(candidate.sourceQuote))
    ) {
      throw new TypeError(
        `Claim ${index} must quote the supplied final response exactly`,
      );
    }
    const expectation =
      candidate.expectation === undefined
        ? undefined
        : parseExpectation(candidate.expectation);
    if (finalResponse !== undefined && !expectation)
      throw new TypeError(`Claim ${index} is missing its expectation`);
    if (finalResponse !== undefined && !finalResponse.includes(candidate.claimText))
      throw new TypeError(`Claim ${index} text is not grounded in the response`);
    if (isFuturePlan(candidate.claimText) || (typeof candidate.sourceQuote === "string" && isFuturePlan(candidate.sourceQuote))) continue;
    const key = `${candidate.claimType}|${candidate.target.toLowerCase()}|${candidate.claimText.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const conservative = expectationFor(candidate.claimText, candidate.claimType);
    if (expectation && conservative.basis !== "operation") Object.assign(expectation, { basis: conservative.basis });
    claims.push({
      claimIndex: claims.length + 1,
      claimText: candidate.claimText,
      claimType: candidate.claimType,
      target: candidate.target,
      expectedResult: candidate.expectedResult,
      ...(typeof candidate.sourceQuote === "string"
        ? { sourceQuote: candidate.sourceQuote }
        : {}),
      ...(expectation ? { expectation } : {}),
    });
  }
  return claims;
}

/** Prompt text for an external model adapter; verdicts are intentionally absent. */
export function buildClaimExtractionPrompt(finalResponse: string): string {
  return [
    "Extract every factual software-engineering claim from the final response.",
    "Split combined sentences into atomic claims. Preserve negation, exact numbers, commands, and file paths.",
    "claimText and sourceQuote must be exact substrings of the final response.",
    "Quote the whole atomic assertion, including its verb, negation, qualifiers and final punctuation. A command or filename alone is not an assertion.",
    "Use basis=operation for directly observable file/command/build/test claims.",
    "Use basis=behavior for semantic claims such as 'validation works' or 'bug fixed'.",
    "Use basis=unverifiable when no deterministic rule can check the statement.",
    "outcome is success or failure. Add passed, failed, skipped, or paths only when explicitly stated.",
    "Return JSON only. Exclude opinions, future plans, and duplicates.",
    "Allowed types: FILE_CREATED, FILE_MODIFIED, STRUCTURE_CREATED, DEPENDENCY_RULE, COMMAND_SUCCEEDED, BUILD_PASSED, TEST_PASSED, TASK_COMPLETED.",
    '[{"claimText":"exact quote","sourceQuote":"exact quote","claimType":"...","target":"...","expectedResult":"...","expectation":{"outcome":"success","basis":"operation","passed":5,"failed":0}}]',
    "Final response:",
    finalResponse,
  ].join("\n");
}

function splitConjunction(statement: string): readonly string[] {
  return statement
    .split(
      /\s+(?:and|aur)\s+(?=(?:\d+|the|all|tamam|sab|four|five|tests?|build|dependencies?|files?|project|command|npm|pnpm|yarn|src\b))/iu,
    )
    .flatMap((value) =>
      value.split(
        /\s*,\s+(?=(?:and\s+)?(?:\d+|the|all|tamam|sab|tests?|build|dependencies?|files?|project|command|npm|pnpm|yarn))/iu,
      ),
    );
}

/** Conservative baseline; the model adapter uses the same expectation schema. */
export function expectationFor(
  statement: string,
  claimType: ClaimType,
): ClaimExpectation {
  const negative =
    /\b(?:failed|failure|did not|didn't|not passed|unsuccessful)\b/iu.test(
      statement,
    ) &&
    !/\b(?:0|zero|no)\s+(?:tests?\s+)?fail(?:ed|ures?)\b/iu.test(statement);
  const semantic = isBehaviorAssertion(statement);
  const hedged = isHedgedAssertion(statement);
  const outsideScope =
    claimType === "TASK_COMPLETED" &&
    /\b(?:clean|contains\s+\d+\s+files)\b/iu.test(statement);
  const counts: Record<string, number> = {};
  if (claimType === "TEST_PASSED") {
    const words: Record<string, number> = {
      zero: 0,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      twelve: 12,
    };
    for (const [key, pattern] of Object.entries({
      passed:
        /(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:tests?\s+)?pass(?:ed)?\b/iu,
      failed:
        /(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:tests?\s+)?fail(?:ed)?\b/iu,
      skipped: /(\d+|zero|one|two|three|four|five)\s+(?:tests?\s+)?skipped\b/iu,
    })) {
      const match = pattern.exec(statement)?.[1]?.toLowerCase();
      if (match) counts[key] = words[match] ?? Number(match);
    }
  }
  return {
    outcome: negative ? "failure" : "success",
    basis:
      outsideScope || hedged
        ? "unverifiable"
        : semantic &&
            ["FILE_CREATED", "FILE_MODIFIED", "TASK_COMPLETED"].includes(
              claimType,
            )
          ? "behavior"
          : "operation",
    ...counts,
  };
}

export function parseExpectation(value: unknown): ClaimExpectation {
  if (
    !isRecord(value) ||
    !["success", "failure"].includes(String(value.outcome)) ||
    !["operation", "behavior", "unverifiable"].includes(String(value.basis))
  )
    throw new TypeError("Invalid claim expectation");
  const allowed = new Set([
    "outcome",
    "basis",
    "passed",
    "failed",
    "skipped",
    "paths",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new TypeError("Unknown expectation field");
  for (const key of ["passed", "failed", "skipped"]) {
    if (
      value[key] !== undefined &&
      (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)
    )
      throw new TypeError(`Invalid expected ${key} count`);
  }
  if (
    value.paths !== undefined &&
    (!Array.isArray(value.paths) ||
      value.paths.length > 100 ||
      !value.paths.every(
        (path) =>
          typeof path === "string" && path.length > 0 && path.length <= 2000,
      ))
  )
    throw new TypeError("Invalid expected paths");
  return value as unknown as ClaimExpectation;
}

function objectiveKeyword(value: string): boolean {
  return (
    isBehaviorAssertion(value) ||
    /\b(?:created?|add(?:ed)?|generated|implemented|modified|updated|changed|edited|fixed|validated|verified|pass(?:ed)?|success(?:ful)?|succeed(?:ed)?|built|compiled|ran|executed|completed|done|finished|install|test|build|command|file|code|validation|architecture|layer|directory|folder|structure|dependenc|import|task)\w*\b/iu.test(
      value,
    ) ||
    /\b(?:npm|pnpm|yarn|npx|node|pytest|vitest|jest|cargo|go)\s+\w+.*\b(?:pass|success|succeed|completed?)\b/iu.test(
      value,
    )
  );
}

function firstStructureTarget(statement: string): string {
  const path =
    /\b(?:src|app|packages|lib|infrastructure)(?:[\\/][\w.*-]+)*/iu.exec(
      statement,
    )?.[0];
  return path ?? "project structure";
}

/** State-of-behaviour predicates require acceptance evidence, not file deltas.
 * Quoted paths are operands; negated and future predicates are not successes. */
export function isBehaviorAssertion(value:string):boolean {
  const prose=value.replace(/`[^`]*`/gu,"TARGET");
  if(/\b(?:not|never|will|might|may|could)\s+(?:(?:be|been|now)\s+){0,2}(?:fixed|resolved|working|works)\b/iu.test(prose))return false;
  const state=/\b(?:(?:is|are|was|were|(?:has|have)\s+been)\s+(?:(?:now|fully|finally|successfully)\s+)*(?:fixed|resolved|functional|working)|works?\s+(?:now|correctly|properly|as\s+expected)|(?:now|correctly|properly|fully)\s+(?:works?|working|functional))\b/iu.test(prose);
  // Semantic entities paired with accomplishment predicates assert behavior,
  // unlike literal file-creation/update operations. Recognize grammatical
  // roles in either order instead of enumerating complete surface phrases.
  const entity='(?:bugs?|issues?|problems?|validation|functionality|features?)';
  const accomplishment='(?:fix(?:ed)?|resolv(?:ed|es?)?|implemented|added|works?)';
  const relation=new RegExp(`\\b${entity}\\b[^.!?]{0,60}\\b${accomplishment}\\b|\\b${accomplishment}\\b[^.!?]{0,60}\\b${entity}\\b`,'iu').test(prose);
  const acceptance=/\bhandles?\s+(?:all\s+)?(?:edge\s+cases|errors?)\b/iu.test(prose);
  return state||relation||acceptance;
}

function structureExpectation(statement: string): string {
  const layers = [
    "domain",
    "application",
    "infrastructure",
    "presentation",
  ].filter((value) => new RegExp(`\\b${value}\\b`, "iu").test(statement));
  return layers.length > 0
    ? `${layers.join(", ")} directories and files exist`
    : "required directories and files exist";
}

function semanticTarget(statement: string, claimType: ClaimType): string {
  const match =
    /\b(?:email\s+validation|login\s+page|validation|component|page|function|feature|bug|error|implementation)\b/iu.exec(
      statement,
    )?.[0];
  return (
    match?.toLowerCase() ??
    (claimType === "FILE_CREATED" ? "created file" : "modified file")
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFuturePlan(text: string): boolean {
  return /\b(?:I|we)[’']ll\b|\b(?:will|going to|plan to|intend to)\b|^\s*(?:then\s+)?(?:run|add|create|inspect|check)\b/iu.test(text);
}

/**
 * Hedged statements about the *current* state ("should be working now",
 * "tests probably pass") are assertions the auditee chose not to commit to.
 * Policy 2.1.0 keeps them visible as UNVERIFIABLE instead of dropping them,
 * so that hedging cannot silently shrink the audited surface. Future plans
 * ("I will run the tests") remain excluded.
 */
export function isHedgedAssertion(statement: string): boolean {
  return (
    /\b(?:should|probably|hopefully|i think|i believe|maybe|might|seems?\s+to|likely)\b/iu.test(
      statement,
    ) &&
    /\b(?:works?|working|pass(?:es|ed|ing)?|fixed|resolved|done|complete(?:d)?|ready|functional|succeed(?:s|ed)?)\b/iu.test(
      statement,
    ) &&
    !isFuturePlan(statement)
  );
}

function hedgedCompletionStatement(raw: string): string | null {
  const cleaned = raw.replace(/^['"“”]|['"“”]$/gu, "").replace(/\s+/gu, " ").trim();
  if (cleaned.length < 4 || cleaned.length > 600) return null;
  return isHedgedAssertion(cleaned) ? cleaned : null;
}
