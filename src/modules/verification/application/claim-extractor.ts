import type { ClaimType } from "../domain/claim-types.js";
import { isClaimType } from "../domain/claim-types.js";
import type { ExtractedClaim } from "../domain/contracts.js";

/** Versioned prompt/schema contract for a future model-backed extractor. */
export const EXTRACTION_PROMPT_VERSION = "1.0.0";

export interface ClaimExtractionRequest {
  readonly finalResponse: string;
  readonly modelName: string;
}

/** Adapter boundary for an LLM or another claim extraction implementation. */
export interface ClaimExtractor {
  extract(request: ClaimExtractionRequest): Promise<readonly ExtractedClaim[]>;
}

/**
 * Local extractor used by the default runtime. It deliberately extracts only
 * objective, evidence-shaped statements; a model adapter can implement the
 * same port later without changing verification or persistence.
 */
export class HeuristicClaimExtractor implements ClaimExtractor {
  public async extract(request: ClaimExtractionRequest): Promise<readonly ExtractedClaim[]> {
    return extractClaims(request.finalResponse);
  }
}

/** Splits a final response into short, independently evaluable statements. */
export function splitAtomicStatements(finalResponse: string): readonly string[] {
  const normalized = finalResponse.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return [];
  const lines = normalized
    .split("\n")
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .filter(Boolean);
  const statements: string[] = [];
  for (const line of lines) {
    const sentences = line.split(/(?<=[.!?;])\s+/u).flatMap(value => splitConjunction(value));
    statements.push(...sentences.map(value => value.trim()).filter(Boolean));
  }
  return statements;
}

/** Removes prose that cannot be checked against captured execution evidence. */
export function removeNonVerifiableText(statement: string): string | null {
  const cleaned = statement
    .replace(/^\s*(?:agent(?:'s)?\s+final\s+answer|final\s+answer)\s*:\s*/iu, "")
    .replace(/^['"“”]|['"“”]$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned || cleaned.length < 4 || cleaned.length > 600) return null;
  if (/\b(?:i think|i believe|probably|hopefully|maybe|should|will|plan to|could|might)\b/iu.test(cleaned)) return null;
  if (/\b(?:great|clean|nice|good|properly|well[- ]structured|looks good)\b/iu.test(cleaned) && !objectiveKeyword(cleaned)) return null;
  return objectiveKeyword(cleaned) ? cleaned : null;
}

/** Classifies one statement using the stable Phase 1 claim vocabulary. */
export function classifyClaimType(statement: string): ClaimType | null {
  const value = statement.toLowerCase();
  if (/\b(?:test|tests|spec|specs|suite|suites|passed|pass)\b/iu.test(value) && /\b(?:pass|passed|success|successful|complete|completed|run|runs|failed|fail)\b/iu.test(value)) return "TEST_PASSED";
  if (/\b(?:build|compiled|compile|compilation)\b/iu.test(value) && /\b(?:pass|passed|success|successful|complete|completed|done|zero\s+errors?)\b/iu.test(value)) return "BUILD_PASSED";
  if (/\b(?:dependenc|import\s+graph|forbidden\s+import|architecture\s+rule|layer[s]?\s+(?:are|were)\s+separat)\b/iu.test(value) && /\b(?:separat|pass|passed|success|successful|valid|validat|no\s+forbidden)\b/iu.test(value)) return "DEPENDENCY_RULE";
  if (/\b(?:architecture|layers?|directories?|folders?|structure)\b/iu.test(value) && /\b(?:created|added|built|setup|set\s+up|organized|exist|implemented)\b/iu.test(value)) return "STRUCTURE_CREATED";
  if (/(?:\b(?:command|ran|run|executed|exit\s*code|exitcode)\b|\b(?:npm|pnpm|yarn|npx|node|pytest|vitest|jest|cargo|go)\s+[\w:.-]+)/iu.test(value) && /\b(?:success|successful|succeeded|passed|complete|completed|zero)\b/iu.test(value)) return "COMMAND_SUCCEEDED";
  if (/\b(?:new\s+file|file\s+(?:was\s+)?(?:created|added|generated)|created\s+(?:a\s+)?(?:new\s+)?file|added\s+(?:a\s+)?(?:new\s+)?file)\b/iu.test(value) || (/(?:created|added|generated|implemented)\w*/iu.test(value) && /(?:[\\/]\w+|\b(?:file|page|component|directory|folder)\b)/iu.test(value))) return "FILE_CREATED";
  if (/\b(?:file|code|readme|package(?:\.json)?|config|manifest|validation|component|page|function|feature|implementation|bug|error)\b/iu.test(value) && /\b(?:modif|updated|changed|edited|fixed|implemented|add|added|applied|created)\w*\b/iu.test(value)) return "FILE_MODIFIED";
  if (/(?:(?:task|request|work|implementation|feature|query|project)\b[^.]{0,80}\b(?:done|completed|finished|implemented)\b|\b(?:task|request|work|implementation|feature|query|project)\s+(?:is|was)\s+(?:done|completed|finished))/iu.test(value)) return "TASK_COMPLETED";
  return null;
}

/** Extracts target and objective expectation for a classified statement. */
export function extractTargetAndExpectedResult(
  statement: string,
  claimType: ClaimType
): { readonly target: string; readonly expectedResult: string } {
  const explicitPath = /`([^`]+)`/u.exec(statement)?.[1]
    ?? /\b(?:src|app|packages|tests?|test|lib|infrastructure|docs)(?:[\\/][\w.*-]+)+(?:\.[\w-]+)?/iu.exec(statement)?.[0];
  const command = /\b(?:npm|pnpm|yarn|npx|node|pytest|vitest|jest|phpunit|cargo|go)\s+(?:run\s+)?[\w:.-]+/iu.exec(statement)?.[0]?.trim();
  const target = explicitPath?.trim().replace(/[.,;:!?]+$/u, "")
    ?? (claimType === "BUILD_PASSED" || claimType === "TEST_PASSED" || claimType === "COMMAND_SUCCEEDED" ? command ?? (claimType === "BUILD_PASSED" ? "build" : claimType === "TEST_PASSED" ? "test execution" : "command execution") : claimType === "DEPENDENCY_RULE" ? "project import graph" : claimType === "STRUCTURE_CREATED" ? firstStructureTarget(statement) : claimType === "TASK_COMPLETED" ? "task" : semanticTarget(statement, claimType));
  const expectedResult = {
    FILE_CREATED: "target exists after the change",
    FILE_MODIFIED: "target changed to the claimed implementation",
    STRUCTURE_CREATED: structureExpectation(statement),
    DEPENDENCY_RULE: "dependency rule passes without forbidden imports",
    COMMAND_SUCCEEDED: "matching command exits with code 0",
    BUILD_PASSED: "exitCode equals 0",
    TEST_PASSED: "exitCode equals 0 and failed equals 0",
    TASK_COMPLETED: "all required objective claims are verified"
  } satisfies Record<ClaimType, string>;
  return { target, expectedResult: expectedResult[claimType] };
}

/** Extracts and validates the stable claim records persisted in AgentClaim. */
export function extractClaims(finalResponse: string): readonly ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();
  for (const rawStatement of splitAtomicStatements(finalResponse)) {
    const statement = removeNonVerifiableText(rawStatement);
    if (!statement) continue;
    const claimType = classifyClaimType(statement);
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
      expectedResult: details.expectedResult
    });
  }
  return claims;
}

/** Validates model JSON before it is allowed to reach persistence. */
export function parseExtractedClaims(value: unknown): readonly ExtractedClaim[] {
  if (!Array.isArray(value)) throw new TypeError("Claim extraction response must be an array");
  const claims: ExtractedClaim[] = [];
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate) || !isClaimType(candidate.claimType) || !nonEmpty(candidate.claimText) || !nonEmpty(candidate.target) || !nonEmpty(candidate.expectedResult)) {
      throw new TypeError(`Invalid extracted claim at index ${index}`);
    }
    claims.push({
      claimIndex: claims.length + 1,
      claimText: candidate.claimText,
      claimType: candidate.claimType,
      target: candidate.target,
      expectedResult: candidate.expectedResult
    });
  }
  return claims;
}

/** Prompt text for an external model adapter; verdicts are intentionally absent. */
export function buildClaimExtractionPrompt(finalResponse: string): string {
  return [
    "Divide the final response into independently verifiable atomic software-engineering claims.",
    "Return JSON only. Exclude opinions, future plans, and duplicate statements.",
    "Allowed types: FILE_CREATED, FILE_MODIFIED, STRUCTURE_CREATED, DEPENDENCY_RULE, COMMAND_SUCCEEDED, BUILD_PASSED, TEST_PASSED, TASK_COMPLETED.",
    '[{"claimText":"...","claimType":"...","target":"...","expectedResult":"..."}]',
    "Final response:",
    finalResponse
  ].join("\n");
}

function splitConjunction(statement: string): readonly string[] {
  return statement.split(/\s+(?:and|aur)\s+(?=(?:the|all|tamam|sab|four|five|tests?|build|dependencies?|files?|project|command|npm|pnpm|yarn|src\b))/iu).flatMap(value => value.split(/\s*,\s+(?=(?:and\s+)?(?:the|all|tamam|sab|tests?|build|dependencies?|files?|project|command|npm|pnpm|yarn))/iu));
}

function objectiveKeyword(value: string): boolean {
  return /\b(?:created?|add(?:ed)?|generated|implemented|modified|updated|changed|edited|fixed|validated|verified|pass(?:ed)?|success(?:ful)?|succeed(?:ed)?|built|compiled|ran|executed|completed|done|finished|install|test|build|command|file|code|validation|architecture|layer|directory|folder|structure|dependenc|import|task)\w*\b/iu.test(value) || /\b(?:npm|pnpm|yarn|npx|node|pytest|vitest|jest|cargo|go)\s+\w+.*\b(?:pass|success|succeed|completed?)\b/iu.test(value);
}

function firstStructureTarget(statement: string): string {
  const path = /\b(?:src|app|packages|lib|infrastructure)(?:[\\/][\w.*-]+)*/iu.exec(statement)?.[0];
  return path ?? "project structure";
}

function structureExpectation(statement: string): string {
  const layers = ["domain", "application", "infrastructure", "presentation"].filter(value => new RegExp(`\\b${value}\\b`, "iu").test(statement));
  return layers.length > 0 ? `${layers.join(", ")} directories and files exist` : "required directories and files exist";
}

function semanticTarget(statement: string, claimType: ClaimType): string {
  const match = /\b(?:email\s+validation|login\s+page|validation|component|page|function|feature|bug|error|implementation)\b/iu.exec(statement)?.[0];
  return match?.toLowerCase() ?? (claimType === "FILE_CREATED" ? "created file" : "modified file");
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
