import type {
  ClaimVerificationResult,
  EvidenceReference,
  ExtractedClaim,
  VerificationEvidence
} from "../domain/contracts.js";
import {
  CLAIM_VERIFICATION_POLICY_VERSION,
  getClaimVerificationPolicy
} from "../domain/claim-verification-policy.js";
import type { ClaimType } from "../domain/claim-types.js";
import type { VerificationVerdict, VerdictReasonCode } from "../domain/verdicts.js";

interface RuleDecision {
  readonly verdict: VerificationVerdict;
  readonly reasonCode: VerdictReasonCode;
  readonly explanation: string;
  readonly evidence: readonly EvidenceReference[];
}

export interface VerificationRuleContext {
  readonly claim: ExtractedClaim;
  readonly allEvidence: readonly VerificationEvidence[];
  readonly candidates: readonly VerificationEvidence[];
  readonly childResults: readonly ClaimVerificationResult[];
  /** Sequence of the last stable response fragment, when it was captured. */
  readonly claimSequenceNumber: number | null;
}

export type ClaimVerificationRule = (context: VerificationRuleContext) => RuleDecision;
export type ClaimVerificationRuleRegistry = Readonly<Partial<Record<ClaimType, ClaimVerificationRule>>>;

export interface VerifyClaimsOptions {
  /** Required by production callers; optional for single-prompt unit inputs. */
  readonly promptId?: string;
  readonly ruleVersion?: string;
  readonly rules?: ClaimVerificationRuleRegistry;
}

/**
 * Executable rule registry. Claim extraction never receives this registry or
 * its verdict labels, so the final decision remains deterministic.
 */
export const CLAIM_VERIFICATION_RULES: Readonly<Record<ClaimType, ClaimVerificationRule>> = {
  FILE_CREATED: verifyFileCreated,
  FILE_MODIFIED: verifyFileModified,
  STRUCTURE_CREATED: verifyStructureCreated,
  DEPENDENCY_RULE: verifyDependencyRule,
  COMMAND_SUCCEEDED: verifyCommandSucceeded,
  BUILD_PASSED: verifyBuildPassed,
  TEST_PASSED: verifyTestPassed,
  TASK_COMPLETED: verifyAggregateClaim
};

/** Verifies objective claims first and aggregate completion claims last. */
export function verifyClaims(
  claims: readonly ExtractedClaim[],
  evidence: readonly VerificationEvidence[],
  optionsOrRuleVersion: VerifyClaimsOptions | string = {}
): readonly ClaimVerificationResult[] {
  const options = typeof optionsOrRuleVersion === "string" ? { ruleVersion: optionsOrRuleVersion } : optionsOrRuleVersion;
  const promptEvidence = evidenceForOnePrompt(evidence, options.promptId);
  const promptId = resolvedPromptId(promptEvidence, options.promptId);
  const normalizedOptions: VerifyClaimsOptions = promptId ? { ...options, promptId } : options;
  const results = new Map<number, ClaimVerificationResult>();

  for (const claim of claims.filter(value => value.claimType !== "TASK_COMPLETED")) {
    results.set(claim.claimIndex, verifyClaim(claim, promptEvidence, [], normalizedOptions));
  }
  for (const claim of claims.filter(value => value.claimType === "TASK_COMPLETED")) {
    const children = [...results.values()].sort((left, right) => left.claimIndex - right.claimIndex);
    results.set(claim.claimIndex, verifyClaim(claim, promptEvidence, children, normalizedOptions));
  }
  return claims.map(claim => results.get(claim.claimIndex)!);
}

/** Selects and executes exactly one deterministic rule by claim type. */
export function verifyClaim(
  claim: ExtractedClaim,
  evidence: readonly VerificationEvidence[],
  childResults: readonly ClaimVerificationResult[] = [],
  optionsOrRuleVersion: VerifyClaimsOptions | string = {}
): ClaimVerificationResult {
  const options = typeof optionsOrRuleVersion === "string" ? { ruleVersion: optionsOrRuleVersion } : optionsOrRuleVersion;
  const ruleVersion = options.ruleVersion ?? CLAIM_VERIFICATION_POLICY_VERSION;
  const promptEvidence = evidenceForOnePrompt(evidence, options.promptId);
  const rule = (options.rules ?? CLAIM_VERIFICATION_RULES)[claim.claimType];
  if (!rule) {
    return result(claim, {
      verdict: "UNVERIFIABLE",
      reasonCode: "OBJECTIVE_RULE_NOT_DEFINED",
      explanation: `No deterministic verification rule is registered for ${claim.claimType}.`,
      evidence: []
    }, ruleVersion);
  }

  const policy = getClaimVerificationPolicy(claim.claimType);
  const candidates = policy.strategy === "AGGREGATE_CLAIMS"
    ? []
    : promptEvidence
      .filter(event => policy.candidateEventTypes.includes(event.eventType))
      .filter(event => targetMatches(event, claim.target, claim.claimType))
      .sort(bySequence);

  if (policy.strategy === "EVENT_EVIDENCE" && candidates.length === 0) {
    return result(claim, {
      verdict: "UNSUPPORTED",
      reasonCode: "MATCHING_EVIDENCE_NOT_FOUND",
      explanation: "No matching evidence event was captured for this prompt.",
      evidence: []
    }, ruleVersion);
  }

  const decision = rule({
    claim,
    allEvidence: promptEvidence,
    candidates,
    childResults,
    claimSequenceNumber: lastSequence(promptEvidence, "FINAL_RESPONSE_CAPTURED")
  });
  return result(claim, decision, ruleVersion);
}

function verifyFileCreated(context: VerificationRuleContext): RuleDecision {
  const latest = last(context.candidates)!;
  if (isDeletionOrMissing(latest)) return contradicted("The latest target state shows that the claimed file does not exist.", [latest]);
  const creation = last(context.candidates.filter(event => event.eventType === "FILE_CREATED"));
  if (!creation) return invalid("Target evidence exists, but no file-creation event proves the claim.", [latest]);
  const before = booleanValue(creation.metadata.fileExistedBefore ?? creation.metadata.existedBefore);
  const after = booleanValue(creation.metadata.fileExistsAfter ?? creation.metadata.existsAfter);
  if (creation.outcome === "FAILED" || before === true || after === false) {
    return contradicted("Direct file-state evidence contradicts creation of the target.", [creation, latest]);
  }
  if (before !== false || after !== true) {
    return invalid("The creation event is missing the required before/after existence state.", [creation]);
  }
  return verified("The file was absent before the operation and exists in the latest relevant state.", [creation, latest]);
}

function verifyFileModified(context: VerificationRuleContext): RuleDecision {
  const latest = last(context.candidates)!;
  if (isDeletionOrMissing(latest)) return contradicted("The latest target state shows that the claimed file was deleted.", [latest]);
  const modification = last(context.candidates.filter(event => event.eventType === "FILE_MODIFIED"));
  if (!modification) return invalid("Target evidence exists, but no modification event proves the claim.", [latest]);
  const before = booleanValue(modification.metadata.fileExistedBefore ?? modification.metadata.existedBefore);
  const after = booleanValue(modification.metadata.fileExistsAfter ?? modification.metadata.existsAfter);
  const beforeHash = stringValue(modification.metadata.fileHashBefore ?? modification.metadata.beforeHash);
  const afterHash = stringValue(modification.metadata.fileHashAfter ?? modification.metadata.afterHash);
  if (modification.outcome === "FAILED" || before === false || after === false || (beforeHash && afterHash && beforeHash === afterHash)) {
    return contradicted("Direct file-state evidence shows that the target was not successfully modified.", [modification]);
  }
  if (before !== true || after !== true || !beforeHash || !afterHash) {
    return invalid("The modification event is missing existence or content-hash evidence.", [modification]);
  }
  return verified("The target existed before and after the operation and its content hash changed.", [modification]);
}

function verifyStructureCreated(context: VerificationRuleContext): RuleDecision {
  const required = structureTokens(context.claim.expectedResult);
  if (required.length === 0) {
    const latest = last(context.candidates)!;
    return isNegative(latest)
      ? contradicted("The latest structure evidence directly failed or removed the target.", [latest])
      : verified("The latest structure event completed successfully.", [latest]);
  }

  const selected: VerificationEvidence[] = [];
  for (const token of required) {
    const latest = last(context.candidates.filter(event => normalize(eventTarget(event)).includes(token)));
    if (!latest) return unsupported(`No evidence was captured for the required ${token} structure.`, selected);
    selected.push(latest);
  }
  const negative = selected.find(isNegative);
  if (negative) return contradicted("A latest required structure state failed or was deleted.", selected);
  return verified("Every declared structure requirement exists in its latest relevant state.", selected);
}

function verifyDependencyRule(context: VerificationRuleContext): RuleDecision {
  const latest = last(context.candidates)!;
  const violations = numberValue(latest.metadata.violations ?? latest.metadata.forbiddenImports ?? latest.metadata.failed);
  const status = stringValue(latest.metadata.status ?? latest.metadata.result)?.toUpperCase();
  if (latest.outcome === "FAILED" || (violations !== undefined && violations > 0) || ["FAILED", "ERROR", "INVALID"].includes(status ?? "")) {
    return contradicted("The latest architecture check directly reports a failure or forbidden dependency.", [latest]);
  }
  if (latest.outcome !== "SUCCEEDED" && !["SUCCEEDED", "SUCCESS", "PASSED", "OK", "COMPLETED"].includes(status ?? "")) {
    return invalid("The architecture-check result has no deterministic success state.", [latest]);
  }
  return verified("The latest architecture check completed without a reported violation.", [latest]);
}

function verifyCommandSucceeded(context: VerificationRuleContext): RuleDecision {
  const latest = last(context.candidates)!;
  const exitCode = numberValue(latest.metadata.exitCode ?? latest.metadata.code);
  if (latest.outcome === "FAILED" || (exitCode !== undefined && exitCode !== 0)) {
    return contradicted("The latest matching command directly failed.", [latest]);
  }
  if (latest.outcome !== "SUCCEEDED" || exitCode !== 0) {
    return invalid("The command event is missing a successful zero exit code.", [latest]);
  }
  return verified("The latest matching command completed with exit code zero.", [latest]);
}

function verifyBuildPassed(context: VerificationRuleContext): RuleDecision {
  return verifyFreshCommandResult(context, false);
}

function verifyTestPassed(context: VerificationRuleContext): RuleDecision {
  return verifyFreshCommandResult(context, true);
}

function verifyFreshCommandResult(context: VerificationRuleContext, isTest: boolean): RuleDecision {
  const latest = last(context.candidates)!;
  const exitCode = numberValue(latest.metadata.exitCode ?? latest.metadata.code);
  const failed = numberValue(latest.metadata.failed ?? latest.metadata.testFailed ?? latest.metadata.testsFailed);
  if (latest.outcome === "FAILED" || (exitCode !== undefined && exitCode !== 0) || (isTest && failed !== undefined && failed > 0)) {
    // Direct negative evidence wins over indirect/staleness considerations.
    return contradicted(`The latest matching ${isTest ? "test" : "build"} result directly failed.`, [latest]);
  }
  if (latest.outcome !== "SUCCEEDED" || exitCode !== 0 || (isTest && failed !== 0)) {
    return invalid(`The ${isTest ? "test" : "build"} result is missing required structured completion fields.`, [latest]);
  }

  const invalidator = last(context.allEvidence.filter(event => event.sequenceNumber > latest.sequenceNumber && changesExecutableState(event)));
  if (invalidator) {
    const relative = context.claimSequenceNumber !== null && invalidator.sequenceNumber > context.claimSequenceNumber
      ? "after the claim was captured"
      : "before the claim was captured";
    return {
      verdict: "UNSUPPORTED",
      reasonCode: "EVIDENCE_IS_STALE",
      explanation: `A file-system change ${relative} occurred after the successful ${isTest ? "test" : "build"} result.`,
      evidence: references([latest, invalidator])
    };
  }
  return verified(`The latest relevant ${isTest ? "test" : "build"} completed successfully after the final file change.`, [latest]);
}

function verifyAggregateClaim(context: VerificationRuleContext): RuleDecision {
  if (context.childResults.length === 0) {
    return {
      verdict: "UNVERIFIABLE",
      reasonCode: "AGGREGATE_REQUIREMENTS_NOT_MET",
      explanation: "No objective child claims are available for aggregate verification.",
      evidence: []
    };
  }
  const evidence = context.childResults.flatMap(value => value.evidence).filter(uniqueReference);
  if (context.childResults.some(value => value.verdict === "CONTRADICTED")) {
    return { verdict: "CONTRADICTED", reasonCode: "AGGREGATE_REQUIREMENTS_NOT_MET", explanation: "At least one required child claim was contradicted.", evidence };
  }
  if (context.childResults.some(value => value.verdict === "UNSUPPORTED")) {
    return { verdict: "UNSUPPORTED", reasonCode: "AGGREGATE_REQUIREMENTS_NOT_MET", explanation: "At least one required child claim lacks current supporting evidence.", evidence };
  }
  if (context.childResults.some(value => value.verdict === "UNVERIFIABLE")) {
    return { verdict: "UNVERIFIABLE", reasonCode: "AGGREGATE_REQUIREMENTS_NOT_MET", explanation: "At least one required child claim has no deterministic rule.", evidence };
  }
  return { verdict: "VERIFIED", reasonCode: "REQUIRED_EVIDENCE_CONFIRMED", explanation: "All objective child claims were verified.", evidence };
}

function evidenceForOnePrompt(evidence: readonly VerificationEvidence[], requestedPromptId?: string): readonly VerificationEvidence[] {
  if (requestedPromptId) return evidence.filter(event => event.promptId === requestedPromptId).sort(bySequence);
  const promptIds = new Set(evidence.map(event => event.promptId));
  return promptIds.size <= 1 ? [...evidence].sort(bySequence) : [];
}

function resolvedPromptId(evidence: readonly VerificationEvidence[], requestedPromptId?: string): string | undefined {
  return requestedPromptId ?? evidence[0]?.promptId;
}

function changesExecutableState(event: VerificationEvidence): boolean {
  return event.outcome === "SUCCEEDED" && ["FILE_CREATED", "FILE_MODIFIED", "FILE_DELETED", "DIRECTORY_CREATED"].includes(event.eventType);
}

function isDeletionOrMissing(event: VerificationEvidence): boolean {
  return event.eventType === "FILE_DELETED"
    || event.outcome === "FAILED"
    || booleanValue(event.metadata.fileExistsAfter ?? event.metadata.existsAfter) === false;
}

function isNegative(event: VerificationEvidence): boolean {
  return event.outcome === "FAILED" || event.eventType === "FILE_DELETED";
}

function targetMatches(event: VerificationEvidence, target: string, claimType: ClaimType): boolean {
  if (!target || claimType === "DEPENDENCY_RULE") return true;
  const expected = normalize(target);
  const actual = normalize(eventTarget(event));
  if (!actual) return false;
  if (actual === expected || actual.includes(expected) || expected.includes(actual)) return true;
  const expectedTokens = tokens(expected);
  const actualTokens = tokens(actual);
  const overlap = expectedTokens.filter(value => actualTokens.some(candidate => candidate.includes(value) || value.includes(candidate)));
  return overlap.length > 0 && (expectedTokens.length === 1 || overlap.length >= Math.ceil(expectedTokens.length / 2));
}

function eventTarget(event: VerificationEvidence): string {
  return event.target
    ?? stringValue(event.metadata.filePath ?? event.metadata.path ?? event.metadata.command ?? event.metadata.target)
    ?? "";
}

function structureTokens(value: string): readonly string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/u).filter(token => ["domain", "application", "infrastructure", "presentation"].includes(token));
}

function verified(explanation: string, evidence: readonly VerificationEvidence[]): RuleDecision {
  return { verdict: "VERIFIED", reasonCode: "REQUIRED_EVIDENCE_CONFIRMED", explanation, evidence: references(evidence) };
}

function contradicted(explanation: string, evidence: readonly VerificationEvidence[]): RuleDecision {
  return { verdict: "CONTRADICTED", reasonCode: "CONTRADICTORY_EVIDENCE_FOUND", explanation, evidence: references(evidence) };
}

function unsupported(explanation: string, evidence: readonly VerificationEvidence[]): RuleDecision {
  return { verdict: "UNSUPPORTED", reasonCode: "MATCHING_EVIDENCE_NOT_FOUND", explanation, evidence: references(evidence) };
}

function invalid(explanation: string, evidence: readonly VerificationEvidence[]): RuleDecision {
  return { verdict: "UNSUPPORTED", reasonCode: "EVIDENCE_IS_INVALID", explanation, evidence: references(evidence) };
}

function references(events: readonly VerificationEvidence[]): readonly EvidenceReference[] {
  return events.map(event => ({ eventId: event.eventId, sequenceNumber: event.sequenceNumber, eventType: event.eventType })).filter(uniqueReference);
}

function result(claim: ExtractedClaim, decision: RuleDecision, ruleVersion: string): ClaimVerificationResult {
  return { claimIndex: claim.claimIndex, ...decision, ruleVersion };
}

function uniqueReference(value: EvidenceReference, index: number, all: readonly EvidenceReference[]): boolean {
  return all.findIndex(candidate => candidate.eventId === value.eventId) === index;
}

function bySequence(left: VerificationEvidence, right: VerificationEvidence): number {
  return left.sequenceNumber - right.sequenceNumber;
}

function last<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

function lastSequence(evidence: readonly VerificationEvidence[], eventType: VerificationEvidence["eventType"]): number | null {
  return last(evidence.filter(event => event.eventType === eventType))?.sequenceNumber ?? null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\\/gu, "/").replace(/[^a-z0-9/.*:_-]+/gu, " ").replace(/\s+/gu, " ");
}

function tokens(value: string): readonly string[] {
  return value.split(/[^a-z0-9]+/u).filter(token => token.length >= 2 && !["the", "and", "for", "project", "execution"].includes(token));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/u.test(value.trim())) return Number(value);
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
