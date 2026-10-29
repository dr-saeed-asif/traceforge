import type {
  ClaimVerificationResult,
  EvidenceReference,
  ExtractedClaim,
  VerificationEvidence,
} from "../domain/contracts.js";
import {
  CLAIM_VERIFICATION_POLICY_VERSION,
  getClaimVerificationPolicy,
} from "../domain/claim-verification-policy.js";
import type { ClaimType } from "../domain/claim-types.js";
import type {
  VerificationVerdict,
  VerdictReasonCode,
} from "../domain/verdicts.js";
import { expectationFor } from "./claim-extractor.js";

interface RuleDecision {
  readonly verdict: VerificationVerdict;
  readonly reasonCode: VerdictReasonCode;
  readonly explanation: string;
  readonly evidence: readonly EvidenceReference[];
}

export interface VerificationRuleContext {
  readonly freshness?: boolean;
  readonly claim: ExtractedClaim;
  readonly allEvidence: readonly VerificationEvidence[];
  readonly candidates: readonly VerificationEvidence[];
  readonly childResults: readonly ClaimVerificationResult[];
  /** Sequence of the last stable response fragment, when it was captured. */
  readonly claimSequenceNumber: number | null;
}

export type ClaimVerificationRule = (
  context: VerificationRuleContext,
) => RuleDecision;
export type ClaimVerificationRuleRegistry = Readonly<
  Partial<Record<ClaimType, ClaimVerificationRule>>
>;

export interface VerifyClaimsOptions {
  readonly targetMatching?: "strict" | "legacy-token";
  /** Research ablation only; production defaults to freshness checks. */
  readonly freshness?: boolean;
  /** Required by production callers; optional for single-prompt unit inputs. */
  readonly promptId?: string;
  readonly ruleVersion?: string;
  readonly rules?: ClaimVerificationRuleRegistry;
}

/**
 * Executable rule registry. Claim extraction never receives this registry or
 * its verdict labels, so the final decision remains deterministic.
 */
export const CLAIM_VERIFICATION_RULES: Readonly<
  Record<ClaimType, ClaimVerificationRule>
> = {
  FILE_CREATED: verifyFileCreated,
  FILE_MODIFIED: verifyFileModified,
  STRUCTURE_CREATED: verifyStructureCreated,
  DEPENDENCY_RULE: verifyDependencyRule,
  COMMAND_SUCCEEDED: verifyCommandSucceeded,
  BUILD_PASSED: verifyBuildPassed,
  TEST_PASSED: verifyTestPassed,
  TASK_COMPLETED: verifyAggregateClaim,
};

/** Verifies objective claims first and aggregate completion claims last. */
export function verifyClaims(
  claims: readonly ExtractedClaim[],
  evidence: readonly VerificationEvidence[],
  optionsOrRuleVersion: VerifyClaimsOptions | string = {},
): readonly ClaimVerificationResult[] {
  const options =
    typeof optionsOrRuleVersion === "string"
      ? { ruleVersion: optionsOrRuleVersion }
      : optionsOrRuleVersion;
  const promptEvidence = evidenceForOnePrompt(evidence, options.promptId);
  const promptId = resolvedPromptId(promptEvidence, options.promptId);
  const normalizedOptions: VerifyClaimsOptions = promptId
    ? { ...options, promptId }
    : options;
  const claimTimeEvidence = evidenceAtClaimTime(promptEvidence);
  const results = new Map<number, ClaimVerificationResult>();

  for (const claim of claims.filter(
    (value) => value.claimType !== "TASK_COMPLETED",
  )) {
    results.set(
      claim.claimIndex,
      verifyPreparedClaim(claim, claimTimeEvidence, [], normalizedOptions),
    );
  }
  for (const claim of claims.filter(
    (value) => value.claimType === "TASK_COMPLETED",
  )) {
    const children = [...results.values()].sort(
      (left, right) => left.claimIndex - right.claimIndex,
    );
    results.set(
      claim.claimIndex,
      verifyPreparedClaim(claim, claimTimeEvidence, children, normalizedOptions),
    );
  }
  return claims.map((claim) => results.get(claim.claimIndex)!);
}

/** Selects and executes exactly one deterministic rule by claim type. */
export function verifyClaim(
  claim: ExtractedClaim,
  evidence: readonly VerificationEvidence[],
  childResults: readonly ClaimVerificationResult[] = [],
  optionsOrRuleVersion: VerifyClaimsOptions | string = {},
): ClaimVerificationResult {
  const options =
    typeof optionsOrRuleVersion === "string"
      ? { ruleVersion: optionsOrRuleVersion }
      : optionsOrRuleVersion;
  // Claims are judged at claim time: only evidence observed up to the final
  // response that contains the claim is admissible (Eq. freshness, t_c).
  const promptEvidence = evidenceAtClaimTime(
    evidenceForOnePrompt(evidence, options.promptId),
  );
  return verifyPreparedClaim(claim, promptEvidence, childResults, options);
}

/** Batch callers prepare the identical sorted claim-time trace only once. */
function verifyPreparedClaim(
  claim: ExtractedClaim,
  promptEvidence: readonly VerificationEvidence[],
  childResults: readonly ClaimVerificationResult[],
  options: VerifyClaimsOptions,
): ClaimVerificationResult {
  const ruleVersion = options.ruleVersion ?? CLAIM_VERIFICATION_POLICY_VERSION;
  const expectation =
    claim.expectation ?? expectationFor(claim.claimText, claim.claimType);
  if (
    expectation.basis === "unverifiable" ||
    expectation.basis === "behavior"
  ) {
    return result(
      claim,
      {
        verdict: "UNVERIFIABLE",
        reasonCode: "OBJECTIVE_RULE_NOT_DEFINED",
        explanation:
          expectation.basis === "behavior"
            ? "An observed file change cannot prove the claimed behavior; an independent acceptance check is required."
            : "This claim is outside the configured deterministic verification scope.",
        evidence: [],
      },
      ruleVersion,
    );
  }
  const rule = (options.rules ?? CLAIM_VERIFICATION_RULES)[claim.claimType];
  if (!rule) {
    return result(
      claim,
      {
        verdict: "UNVERIFIABLE",
        reasonCode: "OBJECTIVE_RULE_NOT_DEFINED",
        explanation: `No deterministic verification rule is registered for ${claim.claimType}.`,
        evidence: [],
      },
      ruleVersion,
    );
  }

  const policy = getClaimVerificationPolicy(claim.claimType);
  const candidates =
    policy.strategy === "AGGREGATE_CLAIMS"
      ? []
      : promptEvidence
          .filter((event) =>
            policy.candidateEventTypes.includes(event.eventType),
          )
          .filter((event) =>
            targetMatches(event, claim.target, claim.claimType, options.targetMatching),
          );

  if (policy.strategy === "EVENT_EVIDENCE" && candidates.length === 0) {
    return result(
      claim,
      {
        verdict: "UNSUPPORTED",
        reasonCode: "MATCHING_EVIDENCE_NOT_FOUND",
        explanation: "No matching evidence event was captured for this prompt.",
        evidence: [],
      },
      ruleVersion,
    );
  }

  if (options.targetMatching !== "legacy-token" && ["COMMAND_SUCCEEDED", "TEST_PASSED", "BUILD_PASSED"].includes(claim.claimType) &&
      ["command", "command execution", "test execution", "build"].includes(normalize(claim.target)) &&
      new Set(candidates.map(event => commandIdentity(eventTarget(event)))).size > 1) {
    return result(claim, { verdict: "UNSUPPORTED", reasonCode: "MATCHING_EVIDENCE_NOT_FOUND", explanation: "The claim does not identify which of several different commands it refers to.", evidence: [] }, ruleVersion);
  }
  if (options.targetMatching !== "legacy-token" && ["FILE_CREATED", "FILE_MODIFIED"].includes(claim.claimType) &&
      new Set(candidates.map(event => eventTarget(event).replace(/\\/gu,"/").replace(/^\.\//u,""))).size > 1) {
    return result(claim, unsupported("Ambiguous file suffix matches multiple distinct observed paths.", []), ruleVersion);
  }
  const decision = rule({
    ...(options.freshness === undefined ? {} : { freshness: options.freshness }),
    claim,
    allEvidence: promptEvidence,
    candidates,
    childResults,
    claimSequenceNumber: lastSequence(
      promptEvidence,
      "FINAL_RESPONSE_CAPTURED",
    ),
  });
  return result(claim, decision, ruleVersion);
}

function verifyFileCreated(context: VerificationRuleContext): RuleDecision {
  const latest = last(context.candidates)!;
  if (isDeletionOrMissing(latest))
    return contradicted(
      "The latest target state shows that the claimed file does not exist.",
      [latest],
    );
  const creation = last(
    context.candidates.filter((event) => event.eventType === "FILE_CREATED"),
  );
  if (!creation)
    return invalid(
      "Target evidence exists, but no file-creation event proves the claim.",
      [latest],
    );
  const before = booleanValue(
    creation.metadata.fileExistedBefore ?? creation.metadata.existedBefore,
  );
  const after = booleanValue(
    creation.metadata.fileExistsAfter ?? creation.metadata.existsAfter,
  );
  if (creation.outcome === "FAILED" || before === true || after === false) {
    return contradicted(
      "Direct file-state evidence contradicts creation of the target.",
      [creation, latest],
    );
  }
  if (before !== false || after !== true) {
    return invalid(
      "The creation event is missing the required before/after existence state.",
      [creation],
    );
  }
  return verified(
    "The file was absent before the operation and exists in the latest relevant state.",
    [creation, latest],
  );
}

function verifyFileModified(context: VerificationRuleContext): RuleDecision {
  const latest = last(context.candidates)!;
  if (isDeletionOrMissing(latest))
    return contradicted(
      "The latest target state shows that the claimed file was deleted.",
      [latest],
    );
  const modification = last(
    context.candidates.filter((event) => event.eventType === "FILE_MODIFIED"),
  );
  if (!modification)
    return invalid(
      "Target evidence exists, but no modification event proves the claim.",
      [latest],
    );
  const before = booleanValue(
    modification.metadata.fileExistedBefore ??
      modification.metadata.existedBefore,
  );
  const after = booleanValue(
    modification.metadata.fileExistsAfter ?? modification.metadata.existsAfter,
  );
  const beforeHash = stringValue(
    modification.metadata.fileHashBefore ?? modification.metadata.beforeHash,
  );
  const afterHash = stringValue(
    modification.metadata.fileHashAfter ?? modification.metadata.afterHash,
  );
  if (
    modification.outcome === "FAILED" ||
    before === false ||
    after === false ||
    (beforeHash && afterHash && beforeHash === afterHash)
  ) {
    return contradicted(
      "Direct file-state evidence shows that the target was not successfully modified.",
      [modification],
    );
  }
  if (before !== true || after !== true || !beforeHash || !afterHash) {
    return invalid(
      "The modification event is missing existence or content-hash evidence.",
      [modification],
    );
  }
  return verified(
    "The target existed before and after the operation and its content hash changed.",
    [modification],
  );
}

function verifyStructureCreated(
  context: VerificationRuleContext,
): RuleDecision {
  const declaredPaths = (expected(context).paths ?? [])
    .map((path) => stripDotSlash(normalize(path).trim()))
    .filter(Boolean);
  const required = [
    ...new Set([
      ...declaredPaths,
      ...structureTokens(context.claim.expectedResult),
    ]),
  ];
  if (required.length === 0) {
    // Policy 2.1.0: a structure claim that names no checkable path cannot be
    // supported by "some file was created" alone.
    return invalid(
      "The structure claim declares no checkable directory or file path.",
      context.candidates.slice(-1),
    );
  }

  const selected: VerificationEvidence[] = [];
  for (const token of required) {
    const latest = last(
      context.candidates.filter((event) => {
        const observed = stripDotSlash(normalize(eventTarget(event)).trim());
        return declaredPaths.includes(token)
          ? observed === token ||
              observed.endsWith(`/${token}`) ||
              observed.startsWith(`${token}/`) ||
              observed.includes(`/${token}/`)
          : observed.includes(token);
      }),
    );
    if (!latest)
      return unsupported(
        `No evidence was captured for the required ${token} structure.`,
        selected,
      );
    selected.push(latest);
  }
  const negative = selected.find(isNegative);
  if (negative)
    return contradicted(
      "A latest required structure state failed or was deleted.",
      selected,
    );
  return verified(
    "Every declared structure requirement exists in its latest relevant state.",
    selected,
  );
}

function verifyDependencyRule(context: VerificationRuleContext): RuleDecision {
  const latest = last(context.candidates)!;
  const violations = numberValue(
    latest.metadata.violations ??
      latest.metadata.forbiddenImports ??
      latest.metadata.failed,
  );
  const status = stringValue(
    latest.metadata.status ?? latest.metadata.result,
  )?.toUpperCase();
  if (
    latest.outcome === "FAILED" ||
    (violations !== undefined && violations > 0) ||
    ["FAILED", "ERROR", "INVALID"].includes(status ?? "")
  ) {
    return contradicted(
      "The latest architecture check directly reports a failure or forbidden dependency.",
      [latest],
    );
  }
  if (
    latest.outcome !== "SUCCEEDED" &&
    !["SUCCEEDED", "SUCCESS", "PASSED", "OK", "COMPLETED"].includes(
      status ?? "",
    )
  ) {
    return invalid(
      "The architecture-check result has no deterministic success state.",
      [latest],
    );
  }
  return verified(
    "The latest architecture check completed without a reported violation.",
    [latest],
  );
}

function verifyCommandSucceeded(
  context: VerificationRuleContext,
): RuleDecision {
  const latest = last(context.candidates)!;
  const exitCode = numberValue(
    latest.metadata.exitCode ?? latest.metadata.code,
  );
  const expectsFailure = expected(context).outcome === "failure";
  if (expectsFailure) {
    return latest.outcome === "FAILED" ||
      (exitCode !== undefined && exitCode !== 0)
      ? verified("The matching command failed as claimed.", [latest])
      : contradicted(
          "The matching command succeeded, contradicting the claimed failure.",
          [latest],
        );
  }
  if (
    latest.outcome === "FAILED" ||
    (exitCode !== undefined && exitCode !== 0)
  ) {
    return contradicted("The latest matching command directly failed.", [
      latest,
    ]);
  }
  if (latest.outcome !== "SUCCEEDED" || exitCode !== 0) {
    return invalid(
      "The command event is missing a successful zero exit code.",
      [latest],
    );
  }
  return verified(
    "The latest matching command completed with exit code zero.",
    [latest],
  );
}

function verifyBuildPassed(context: VerificationRuleContext): RuleDecision {
  return verifyFreshCommandResult(context, false);
}

function verifyTestPassed(context: VerificationRuleContext): RuleDecision {
  return verifyFreshCommandResult(context, true);
}

function verifyFreshCommandResult(
  context: VerificationRuleContext,
  isTest: boolean,
): RuleDecision {
  const latest = last(context.candidates)!;
  const exitCode = numberValue(
    latest.metadata.exitCode ?? latest.metadata.code,
  );
  const failed = numberValue(
    latest.metadata.failed ??
      latest.metadata.testFailed ??
      latest.metadata.testsFailed,
  );
  const expectation = expected(context);
  const observedFailure =
    latest.outcome === "FAILED" ||
    (exitCode !== undefined && exitCode !== 0) ||
    (isTest && failed !== undefined && failed > 0);
  if (expectation.outcome === "failure") {
    return observedFailure
      ? verified(
          `The matching ${isTest ? "test" : "build"} failed as claimed.`,
          [latest],
        )
      : contradicted(
          `The matching ${isTest ? "test" : "build"} succeeded, contradicting the claimed failure.`,
          [latest],
        );
  }
  if (observedFailure) {
    // Direct negative evidence wins over indirect/staleness considerations.
    return contradicted(
      `The latest matching ${isTest ? "test" : "build"} result directly failed.`,
      [latest],
    );
  }
  if (
    latest.outcome !== "SUCCEEDED" ||
    exitCode !== 0 ||
    (isTest && failed !== 0)
  ) {
    return invalid(
      `The ${isTest ? "test" : "build"} result is missing required structured completion fields.`,
      [latest],
    );
  }
  if (isTest) {
    for (const [label, expectedValue, actualValue] of [
      [
        "passed",
        expectation.passed,
        numberValue(
          latest.metadata.passed ??
            latest.metadata.testPassed ??
            latest.metadata.testsPassed,
        ),
      ],
      ["failed", expectation.failed, failed],
      [
        "skipped",
        expectation.skipped,
        numberValue(
          latest.metadata.skipped ??
            latest.metadata.testSkipped ??
            latest.metadata.testsSkipped,
        ),
      ],
    ] as const) {
      if (expectedValue === undefined) continue;
      if (actualValue === undefined)
        return invalid(
          `The claim specifies ${expectedValue} ${label}, but the captured test event has no ${label} count.`,
          [latest],
        );
      if (actualValue !== expectedValue)
        return contradicted(
          `The claim specifies ${expectedValue} ${label}, but the captured test event reports ${actualValue}.`,
          [latest],
        );
    }
  }

  const label = isTest ? "test" : "build";
  if (context.freshness !== false && context.allEvidence.some(event => event.sequenceNumber >= latest.sequenceNumber && stringValue(event.metadata.workspaceObservation) === "incomplete")) {
    return invalid(
      `The workspace could not be fully observed around the ${label} run, so freshness cannot be established.`,
      [latest],
    );
  }
  const sameInvocationChanges = stringArray(latest.metadata.changedPaths);
  if (sameInvocationChanges.length > 0 && context.freshness !== false) {
    return {
      verdict: "UNSUPPORTED",
      reasonCode: "EVIDENCE_IS_STALE",
      explanation: `${sameInvocationChanges.length} workspace file(s) changed during the same ${label} invocation (e.g. ${sameInvocationChanges[0]}), so the result may not reflect the final state.`,
      evidence: references([latest]),
    };
  }
  const invalidator = last(
    context.allEvidence.filter(
      (event) =>
        event.sequenceNumber > latest.sequenceNumber &&
        changesExecutableState(event),
    ),
  );
  if (invalidator && context.freshness !== false) {
    return {
      verdict: "UNSUPPORTED",
      reasonCode: "EVIDENCE_IS_STALE",
      explanation: `A file-system change (${eventTarget(invalidator) || invalidator.eventType}) occurred after the successful ${label} result and before the claim.`,
      evidence: references([latest, invalidator]),
    };
  }
  const testEdits = isTest
    ? context.allEvidence.filter(
        (event) =>
          event.sequenceNumber < latest.sequenceNumber &&
          ["FILE_MODIFIED", "FILE_DELETED"].includes(event.eventType) &&
          isTestPath(eventTarget(event)),
      )
    : [];
  if (testEdits.length > 0) {
    return verified(
      `The latest relevant test completed successfully after the final file change. Advisory: ${testEdits.length} existing test file(s) were modified or deleted in this prompt before the passing run (e.g. ${eventTarget(testEdits[0]!)}); review them for weakened assertions.`,
      [latest, ...testEdits],
    );
  }
  return verified(
    `The latest relevant ${label} completed successfully after the final file change.`,
    [latest],
  );
}

function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|spec)\/|\.(?:test|spec)\.[a-z0-9]+$|(?:^|\/)test_[^/]+\.py$|_test\.(?:go|py)$/iu.test(
    path.replace(/\\/gu, "/"),
  );
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function verifyAggregateClaim(context: VerificationRuleContext): RuleDecision {
  if (context.childResults.length === 0) {
    return {
      verdict: "UNVERIFIABLE",
      reasonCode: "AGGREGATE_REQUIREMENTS_NOT_MET",
      explanation:
        "No objective child claims are available for aggregate verification.",
      evidence: [],
    };
  }
  const evidence = context.childResults
    .flatMap((value) => value.evidence)
    .filter(uniqueReference);
  if (context.childResults.some((value) => value.verdict === "CONTRADICTED")) {
    return {
      verdict: "CONTRADICTED",
      reasonCode: "AGGREGATE_REQUIREMENTS_NOT_MET",
      explanation: "At least one required child claim was contradicted.",
      evidence,
    };
  }
  if (context.childResults.some((value) => value.verdict === "UNSUPPORTED")) {
    return {
      verdict: "UNSUPPORTED",
      reasonCode: "AGGREGATE_REQUIREMENTS_NOT_MET",
      explanation:
        "At least one required child claim lacks current supporting evidence.",
      evidence,
    };
  }
  if (context.childResults.some((value) => value.verdict === "UNVERIFIABLE")) {
    return {
      verdict: "UNVERIFIABLE",
      reasonCode: "AGGREGATE_REQUIREMENTS_NOT_MET",
      explanation:
        "At least one required child claim has no deterministic rule.",
      evidence,
    };
  }
  return {
    verdict: "VERIFIED",
    reasonCode: "REQUIRED_EVIDENCE_CONFIRMED",
    explanation:
      "Every other objective claim extracted from this report was verified. This establishes consistency of the report with the trace, not that the task's requirements were met.",
    evidence,
  };
}

function evidenceForOnePrompt(
  evidence: readonly VerificationEvidence[],
  requestedPromptId?: string,
): readonly VerificationEvidence[] {
  if (requestedPromptId)
    return evidence
      .filter((event) => event.promptId === requestedPromptId)
      .sort(bySequence);
  const promptIds = new Set(evidence.map((event) => event.promptId));
  return promptIds.size <= 1 ? [...evidence].sort(bySequence) : [];
}

function resolvedPromptId(
  evidence: readonly VerificationEvidence[],
  requestedPromptId?: string,
): string | undefined {
  return requestedPromptId ?? evidence[0]?.promptId;
}

function changesExecutableState(event: VerificationEvidence): boolean {
  return (
    event.outcome === "SUCCEEDED" &&
    [
      "FILE_CREATED",
      "FILE_MODIFIED",
      "FILE_DELETED",
      "DIRECTORY_CREATED",
    ].includes(event.eventType)
  );
}

function isDeletionOrMissing(event: VerificationEvidence): boolean {
  return (
    event.eventType === "FILE_DELETED" ||
    event.outcome === "FAILED" ||
    booleanValue(
      event.metadata.fileExistsAfter ?? event.metadata.existsAfter,
    ) === false
  );
}

function isNegative(event: VerificationEvidence): boolean {
  return event.outcome === "FAILED" || event.eventType === "FILE_DELETED";
}

/**
 * Generic targets denote "the latest run of this kind" rather than a specific
 * command. They are accepted only for command-like claims, and the rule then
 * judges the latest matching run.
 */
const GENERIC_COMMAND_TARGETS = new Set([
  "command",
  "command execution",
  "test",
  "tests",
  "test execution",
  "test suite",
  "the tests",
  "all tests",
  "build",
  "the build",
  "project build",
]);

/**
 * Strict target correspondence (policy 2.1.0). File claims require the same
 * normalised path, or a claimed relative path that is a whole-segment suffix
 * of the observed path. Command claims require the same normalised command, a
 * whole-word prefix of it, or equality with one `&&`-chained segment; a claimed
 * path is accepted when it appears as a whole argument of the command.
 * Structure claims keep the descriptive matcher because their rule re-checks
 * every declared path.
 */
function targetMatches(
  event: VerificationEvidence,
  target: string,
  claimType: ClaimType,
  mode: "strict" | "legacy-token" = "strict",
): boolean {
  if (claimType === "DEPENDENCY_RULE") return true;
  if (claimType === "STRUCTURE_CREATED" && structureTokens(target).length > 0) {
    const segments = eventTarget(event).replace(/\\/gu, "/").split("/");
    return structureTokens(target).some(token => segments.includes(token));
  }
  const label = normalize(target);
  if (!label) return false;
  if (mode === "legacy-token") {
    const actual = normalize(eventTarget(event));
    if (!actual) return false;
    if (actual === label || actual.includes(label) || label.includes(actual)) return true;
    const expectedTokens = tokens(label), actualTokens = tokens(actual);
    return expectedTokens.filter(token => actualTokens.some(candidate => candidate.includes(token) || token.includes(candidate))).length >= Math.max(1,Math.ceil(expectedTokens.length/2));
  }
  if (claimType === "STRUCTURE_CREATED") {
    const path = eventTarget(event).replace(/\\/gu,"/");
    if (path.startsWith(target.replace(/\\/gu,"/").replace(/\/$/u,"") + "/")) return true;
  }
  if (["COMMAND_SUCCEEDED", "TEST_PASSED", "BUILD_PASSED"].includes(claimType)) {
    if (GENERIC_COMMAND_TARGETS.has(label)) return true;
    const expected = commandIdentity(target);
    const segments = splitCommandSegments(eventTarget(event)).map(commandIdentity);
    if (segments.some(actual => admissibleCommandMatch(expected,actual))) return true;
    if (/[/.]/u.test(target) && !/\s/u.test(target)) {
      return segments.some(segment => {
        const args=segment.split("\u0000"),program=args[0]?.split(/[\\/]/u).at(-1);
        return /^(?:node|python(?:3(?:\.\d+)?)?|bash|sh|deno|bun|tsx|ts-node)$/u.test(program??"") &&
          args.slice(1).some(arg => pathMatches(target,arg.replace(/^["']|["']$/gu,"")));
      });
    }
    return false;
  }
  const path = (value: string) => value.trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
  return pathMatches(path(target), path(eventTarget(event)));

}

/** Extensions cannot silently narrow a test invocation or change its mode. */
function admissibleCommandMatch(expected:string,actual:string):boolean {
  if(actual===expected)return true;
  if(!actual.startsWith(`${expected}\u0000`))return false;
  const base=expected.split("\u0000"),extra=actual.split("\u0000").slice(base.length);
  if(extra.some(arg=>/^(?:--|-t|--testNamePattern|-k|--grep|-g|--dry-run|--watch|--listTests|--onlyChanged)(?:=|$)/u.test(arg)))return false;
  const runner=base.some(arg=>/^(?:tests?|pytest|vitest|jest|mocha|ava|phpunit|nextest)$/u.test(arg))||base.some(arg=>arg==="--test");
  // Unknown runner extensions may carry selectors. Require explicit claims
  // rather than guessing their semantics (includes file/directory operands).
  return !runner;
}

/** Flags, operands, case, and quoted whitespace remain significant. */
function commandIdentity(value: string): string {
  return (value.trim().match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/gu) ?? []).join("\u0000");
}

/** An && inside a quoted argument or substitution is data, not a sibling
 * invocation whose successful completion can be inferred from this event. */
function splitCommandSegments(command:string):string[] {
  const parts:string[]=[];let quote='',escaped=false,depth=0,start=0;
  for(let i=0;i<command.length;i++){
    const ch=command[i]!;
    if(escaped){escaped=false;continue;}
    if(ch==='\\'&&quote!=="'"){escaped=true;continue;}
    if(quote){if(ch===quote)quote='';continue;}
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if(ch==='('||ch==='{')depth++;else if(ch===')'||ch==='}')depth=Math.max(0,depth-1);
    if(depth===0&&ch==='&'&&command[i+1]==='&'){parts.push(command.slice(start,i));start=i+2;i++;}
  }
  if(quote||escaped||depth)return [];
  parts.push(command.slice(start));return parts;
}

function stripDotSlash(value: string): string {
  return value.replace(/^(?:\.\/)+/u, "").replace(/\/+$/u, "");
}

function pathMatches(expected: string, actual: string): boolean {
  const claimed = stripDotSlash(expected);
  const observed = stripDotSlash(actual);
  if (!claimed || claimed.includes(" ")) return false;
  return observed === claimed || observed.endsWith(`/${claimed}`);
}

function evidenceAtClaimTime(
  evidence: readonly VerificationEvidence[],
): readonly VerificationEvidence[] {
  const claimTime = lastSequence(evidence, "FINAL_RESPONSE_CAPTURED");
  return claimTime === null
    ? evidence
    : evidence.filter((event) => event.sequenceNumber <= claimTime);
}

function descriptiveTargetMatches(
  event: VerificationEvidence,
  target: string,
): boolean {
  if (!target) return true;
  const expected = normalize(target);
  const actual = normalize(eventTarget(event));
  if (!actual) return false;
  if (
    actual === expected ||
    actual.includes(expected) ||
    expected.includes(actual)
  )
    return true;
  const expectedTokens = tokens(expected);
  const actualTokens = tokens(actual);
  const overlap = expectedTokens.filter((value) =>
    actualTokens.some(
      (candidate) => candidate.includes(value) || value.includes(candidate),
    ),
  );
  return (
    overlap.length > 0 &&
    (expectedTokens.length === 1 ||
      overlap.length >= Math.ceil(expectedTokens.length / 2))
  );
}

function expected(context: VerificationRuleContext) {
  return (
    context.claim.expectation ??
    expectationFor(context.claim.claimText, context.claim.claimType)
  );
}

function eventTarget(event: VerificationEvidence): string {
  return (
    event.target ??
    stringValue(
      event.metadata.filePath ??
        event.metadata.path ??
        event.metadata.command ??
        event.metadata.target,
    ) ??
    ""
  );
}

function structureTokens(value: string): readonly string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) =>
      ["domain", "application", "infrastructure", "presentation"].includes(
        token,
      ),
    );
}

function verified(
  explanation: string,
  evidence: readonly VerificationEvidence[],
): RuleDecision {
  return {
    verdict: "VERIFIED",
    reasonCode: "REQUIRED_EVIDENCE_CONFIRMED",
    explanation,
    evidence: references(evidence),
  };
}

function contradicted(
  explanation: string,
  evidence: readonly VerificationEvidence[],
): RuleDecision {
  return {
    verdict: "CONTRADICTED",
    reasonCode: "CONTRADICTORY_EVIDENCE_FOUND",
    explanation,
    evidence: references(evidence),
  };
}

function unsupported(
  explanation: string,
  evidence: readonly VerificationEvidence[],
): RuleDecision {
  return {
    verdict: "UNSUPPORTED",
    reasonCode: "MATCHING_EVIDENCE_NOT_FOUND",
    explanation,
    evidence: references(evidence),
  };
}

function invalid(
  explanation: string,
  evidence: readonly VerificationEvidence[],
): RuleDecision {
  return {
    verdict: "UNSUPPORTED",
    reasonCode: "EVIDENCE_IS_INVALID",
    explanation,
    evidence: references(evidence),
  };
}

function references(
  events: readonly VerificationEvidence[],
): readonly EvidenceReference[] {
  return events
    .map((event) => ({
      eventId: event.eventId,
      sequenceNumber: event.sequenceNumber,
      eventType: event.eventType,
    }))
    .filter(uniqueReference);
}

function result(
  claim: ExtractedClaim,
  decision: RuleDecision,
  ruleVersion: string,
): ClaimVerificationResult {
  return { claimIndex: claim.claimIndex, ...decision, ruleVersion };
}

function uniqueReference(
  value: EvidenceReference,
  index: number,
  all: readonly EvidenceReference[],
): boolean {
  return (
    all.findIndex((candidate) => candidate.eventId === value.eventId) === index
  );
}

function bySequence(
  left: VerificationEvidence,
  right: VerificationEvidence,
): number {
  return left.sequenceNumber - right.sequenceNumber;
}

function last<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

function lastSequence(
  evidence: readonly VerificationEvidence[],
  eventType: VerificationEvidence["eventType"],
): number | null {
  return (
    last(evidence.filter((event) => event.eventType === eventType))
      ?.sequenceNumber ?? null
  );
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\\/gu, "/")
    .replace(/[^a-z0-9/.*:_-]+/gu, " ")
    .replace(/\s+/gu, " ");
}

function tokens(value: string): readonly string[] {
  return value
    .split(/[^a-z0-9]+/u)
    .filter(
      (token) =>
        token.length >= 2 &&
        !["the", "and", "for", "project", "execution"].includes(token),
    );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/u.test(value.trim()))
    return Number(value);
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
