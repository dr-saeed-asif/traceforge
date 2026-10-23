import {
  CLAIM_TYPES,
  EXECUTION_STATUSES,
  PROCESSING_STATUSES,
  TRACE_EVENT_OUTCOMES,
  TRACE_EVENT_TYPES,
  VERDICT_REASON_CODES,
  VERIFICATION_VERDICTS,
  type ClaimType,
  type ExecutionStatus,
  type JsonObject,
  type JsonValue,
  type ProcessingStatus,
  type TraceEventOutcome,
  type TraceEventType,
  type VerdictReasonCode,
  type VerificationClaim,
  type VerificationOverview,
  type VerificationOverviewResponse,
  type VerificationPagination,
  type VerificationSession,
  type VerificationSessionDetailsResponse,
  type VerificationSessionDay,
  type VerificationSessionDaysResponse,
  type VerificationSessionsResponse,
  type VerificationTraceEvent,
  type VerificationVerdict,
} from "./types";

export class ContractValidationError extends TypeError {
  public constructor(
    message: string,
    public readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "ContractValidationError";
  }
}

export function parseAnchorLookupResponse(
  value: unknown,
): import("./types").AnchorLookupResponse {
  const input = record(value, "$response");
  return {
    matches: array(input.matches, "$response.matches", (value, path) => {
      const match = record(value, path);
      const sessionHash = nonEmptyString(
        match.sessionHash,
        `${path}.sessionHash`,
      );
      if (!/^0x[0-9a-f]{64}$/.test(sessionHash))
        fail("expected a session SHA-256 hash", path);
      return {
        session: parseSession(match.session, `${path}.session`),
        sessionHash,
        claims: array(match.claims, `${path}.claims`, parseClaim),
      };
    }),
  };
}

export function parseVerificationOverviewResponse(
  value: unknown,
): VerificationOverviewResponse {
  const input = record(value, "$response");
  const sessions = array(input.sessions, "$response.sessions", parseSession);
  const pagination = parsePagination(input.pagination, "$response.pagination");
  assertReturnedCount(
    pagination,
    sessions.length,
    "$response.pagination.returned",
  );
  return {
    overview: parseOverview(input.overview, "$response.overview"),
    sessions,
    pagination,
  };
}

export function parseVerificationSessionsResponse(
  value: unknown,
): VerificationSessionsResponse {
  const input = record(value, "$response");
  const sessions = array(input.sessions, "$response.sessions", parseSession);
  const paginationInput = record(input.pagination, "$response.pagination");
  const basePagination = parsePagination(
    input.pagination,
    "$response.pagination",
  );
  const pagination = {
    ...basePagination,
    // Older Phase 5 API processes do not expose `hasMore`. Keep those
    // responses consumable while a restarted/newer API provides the exact
    // value. The server-side web client also over-fetches one row so this
    // fallback does not create an empty trailing page in the UI.
    hasMore:
      paginationInput.hasMore === undefined
        ? basePagination.returned === basePagination.limit
        : booleanValue(paginationInput.hasMore, "$response.pagination.hasMore"),
  };
  assertReturnedCount(
    pagination,
    sessions.length,
    "$response.pagination.returned",
  );
  return { sessions, pagination };
}

export function parseVerificationSessionDaysResponse(
  value: unknown,
): VerificationSessionDaysResponse {
  const input = record(value, "$response");
  const days = array(input.days, "$response.days", parseSessionDay);
  const paginationInput = record(input.pagination, "$response.pagination");
  const pagination = {
    ...parsePagination(input.pagination, "$response.pagination"),
    hasMore: booleanValue(
      paginationInput.hasMore,
      "$response.pagination.hasMore",
    ),
  };
  assertReturnedCount(pagination, days.length, "$response.pagination.returned");
  return { days, pagination };
}

export function parseVerificationSessionDetailsResponse(
  value: unknown,
): VerificationSessionDetailsResponse {
  const input = record(value, "$response");
  const session = parseSession(input.session, "$response.session");
  const claims = array(input.claims, "$response.claims", parseClaim);
  const traceEvents = array(
    input.traceEvents,
    "$response.traceEvents",
    parseTraceEvent,
  );

  assertUnique(
    claims.map((claim) => claim.claimIndex),
    "$response.claims",
    "claim index",
  );
  assertUnique(
    traceEvents.map((event) => event.eventId),
    "$response.traceEvents",
    "event ID",
  );
  for (let index = 1; index < traceEvents.length; index += 1) {
    if (
      traceEvents[index]!.sequenceNumber <=
      traceEvents[index - 1]!.sequenceNumber
    ) {
      fail(
        "events must be ordered by strictly increasing sequenceNumber",
        "$response.traceEvents",
      );
    }
  }

  const eventIds = new Set(traceEvents.map((event) => event.eventId));
  for (const [claimIndex, claim] of claims.entries()) {
    for (const eventId of claim.evidenceEventIds) {
      if (!eventIds.has(eventId)) {
        fail(
          `references unknown evidence event ${JSON.stringify(eventId)}`,
          `$response.claims[${claimIndex}].evidenceEventIds`,
        );
      }
    }
  }

  return { session, claims, traceEvents };
}

function parseOverview(value: unknown, path: string): VerificationOverview {
  const input = record(value, path);
  const overview = {
    totalSessions: nonNegativeInteger(
      input.totalSessions,
      `${path}.totalSessions`,
    ),
    totalClaims: nonNegativeInteger(input.totalClaims, `${path}.totalClaims`),
    verifiedClaims: nonNegativeInteger(
      input.verifiedClaims,
      `${path}.verifiedClaims`,
    ),
    contradictedClaims: nonNegativeInteger(
      input.contradictedClaims,
      `${path}.contradictedClaims`,
    ),
    unsupportedClaims: nonNegativeInteger(
      input.unsupportedClaims,
      `${path}.unsupportedClaims`,
    ),
    unverifiableClaims: nonNegativeInteger(
      input.unverifiableClaims,
      `${path}.unverifiableClaims`,
    ),
    scoredClaims: nonNegativeInteger(
      input.scoredClaims,
      `${path}.scoredClaims`,
    ),
    reliabilityPercent: nullablePercent(
      input.reliabilityPercent,
      `${path}.reliabilityPercent`,
    ),
    coveragePercent: nullablePercent(
      input.coveragePercent,
      `${path}.coveragePercent`,
    ),
  } satisfies VerificationOverview;
  assertClaimTotals(overview, path);
  return overview;
}

function parseSession(value: unknown, path: string): VerificationSession {
  const input = record(value, path);
  const session = {
    promptId: nonEmptyString(input.promptId, `${path}.promptId`),
    promptQuery:
      input.promptQuery === undefined
        ? null
        : nullableString(input.promptQuery, `${path}.promptQuery`),
    externalSessionId: nonEmptyString(
      input.externalSessionId,
      `${path}.externalSessionId`,
    ),
    runId: nonEmptyString(input.runId, `${path}.runId`),
    projectName: nullableString(input.projectName, `${path}.projectName`),
    projectPath: nullableString(input.projectPath, `${path}.projectPath`),
    agentName: nonEmptyString(input.agentName, `${path}.agentName`),
    modelName: nonEmptyString(input.modelName, `${path}.modelName`),
    ...(input.processingMetrics === undefined
      ? {}
      : {
          processingMetrics:
            input.processingMetrics === null
              ? null
              : parseProcessingMetrics(
                  input.processingMetrics,
                  `${path}.processingMetrics`,
                ),
        }),
    executionStatus: enumValue(
      input.executionStatus,
      EXECUTION_STATUSES,
      `${path}.executionStatus`,
    ) as ExecutionStatus,
    extractionStatus: enumValue(
      input.extractionStatus,
      PROCESSING_STATUSES,
      `${path}.extractionStatus`,
    ) as ProcessingStatus,
    verificationStatus: enumValue(
      input.verificationStatus,
      PROCESSING_STATUSES,
      `${path}.verificationStatus`,
    ) as ProcessingStatus,
    totalClaims: nonNegativeInteger(input.totalClaims, `${path}.totalClaims`),
    verifiedClaims: nonNegativeInteger(
      input.verifiedClaims,
      `${path}.verifiedClaims`,
    ),
    contradictedClaims: nonNegativeInteger(
      input.contradictedClaims,
      `${path}.contradictedClaims`,
    ),
    unsupportedClaims: nonNegativeInteger(
      input.unsupportedClaims,
      `${path}.unsupportedClaims`,
    ),
    unverifiableClaims: nonNegativeInteger(
      input.unverifiableClaims,
      `${path}.unverifiableClaims`,
    ),
    scoredClaims: nonNegativeInteger(
      input.scoredClaims,
      `${path}.scoredClaims`,
    ),
    reliabilityPercent: nullablePercent(
      input.reliabilityPercent,
      `${path}.reliabilityPercent`,
    ),
    coveragePercent: nullablePercent(
      input.coveragePercent,
      `${path}.coveragePercent`,
    ),
    startedAt: isoDate(input.startedAt, `${path}.startedAt`),
    completedAt: nullableIsoDate(input.completedAt, `${path}.completedAt`),
  } satisfies VerificationSession;
  assertClaimTotals(session, path);
  if (
    session.completedAt &&
    Date.parse(session.completedAt) < Date.parse(session.startedAt)
  ) {
    fail("must not be earlier than startedAt", `${path}.completedAt`);
  }
  return session;
}

function parseProcessingMetrics(value: unknown, path: string) {
  const input = record(value, path);
  return {
    ...(input.extractorDurationMs === undefined
      ? {}
      : {
          extractorDurationMs: nullableNonNegativeInteger(
            input.extractorDurationMs,
            `${path}.extractorDurationMs`,
          ),
        }),
    extractorModel: nonEmptyString(
      input.extractorModel,
      `${path}.extractorModel`,
    ),
    extractionStartedAt: isoDate(
      input.extractionStartedAt,
      `${path}.extractionStartedAt`,
    ),
    extractionCompletedAt: nullableIsoDate(
      input.extractionCompletedAt,
      `${path}.extractionCompletedAt`,
    ),
    extractionDurationMs: nullableNonNegativeInteger(
      input.extractionDurationMs,
      `${path}.extractionDurationMs`,
    ),
    verificationStartedAt: nullableIsoDate(
      input.verificationStartedAt,
      `${path}.verificationStartedAt`,
    ),
    verificationCompletedAt: nullableIsoDate(
      input.verificationCompletedAt,
      `${path}.verificationCompletedAt`,
    ),
    verificationDurationMs: nullableNonNegativeInteger(
      input.verificationDurationMs,
      `${path}.verificationDurationMs`,
    ),
  };
}

function parseSessionDay(value: unknown, path: string): VerificationSessionDay {
  const input = record(value, path);
  const sessions = array(input.sessions, `${path}.sessions`, parseSession);
  const date = nonEmptyString(input.date, `${path}.date`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    fail("expected a calendar date in YYYY-MM-DD format", `${path}.date`);
  }
  const day = {
    date,
    queries: nonNegativeInteger(input.queries, `${path}.queries`),
    totalClaims: nonNegativeInteger(input.totalClaims, `${path}.totalClaims`),
    verifiedClaims: nonNegativeInteger(
      input.verifiedClaims,
      `${path}.verifiedClaims`,
    ),
    contradictedClaims: nonNegativeInteger(
      input.contradictedClaims,
      `${path}.contradictedClaims`,
    ),
    unsupportedClaims: nonNegativeInteger(
      input.unsupportedClaims,
      `${path}.unsupportedClaims`,
    ),
    unverifiableClaims: nonNegativeInteger(
      input.unverifiableClaims,
      `${path}.unverifiableClaims`,
    ),
    reliabilityPercent: nullablePercent(
      input.reliabilityPercent,
      `${path}.reliabilityPercent`,
    ),
    sessions,
  } satisfies VerificationSessionDay;
  if (day.queries !== sessions.length) {
    fail("must equal the number of sessions", `${path}.queries`);
  }
  if (
    day.totalClaims !==
    day.verifiedClaims +
      day.contradictedClaims +
      day.unsupportedClaims +
      day.unverifiableClaims
  ) {
    fail("claim counters do not add up to totalClaims", path);
  }
  return day;
}

function parseClaim(value: unknown, path: string): VerificationClaim {
  const input = record(value, path);
  const verdict = nullableEnum(
    input.verdict,
    VERIFICATION_VERDICTS,
    `${path}.verdict`,
  ) as VerificationVerdict | null;
  const reasonCode = nullableEnum(
    input.reasonCode,
    VERDICT_REASON_CODES,
    `${path}.reasonCode`,
  ) as VerdictReasonCode | null;
  const verifiedAt = nullableIsoDate(input.verifiedAt, `${path}.verifiedAt`);
  if (
    (verdict === null) !== (reasonCode === null) ||
    (verdict === null) !== (verifiedAt === null)
  ) {
    fail(
      "verdict, reasonCode and verifiedAt must be null or populated together",
      path,
    );
  }
  return {
    claimIndex: positiveInteger(input.claimIndex, `${path}.claimIndex`),
    claimText: nonEmptyString(input.claimText, `${path}.claimText`),
    claimType: enumValue(
      input.claimType,
      CLAIM_TYPES,
      `${path}.claimType`,
    ) as ClaimType,
    target: nonEmptyString(input.target, `${path}.target`),
    expectedResult: nonEmptyString(
      input.expectedResult,
      `${path}.expectedResult`,
    ),
    verdict,
    reasonCode,
    explanation: nullableString(input.explanation, `${path}.explanation`),
    evidenceEventIds: stringArray(
      input.evidenceEventIds,
      `${path}.evidenceEventIds`,
    ),
    extractorModel: nonEmptyString(
      input.extractorModel,
      `${path}.extractorModel`,
    ),
    extractionPromptVersion: nonEmptyString(
      input.extractionPromptVersion,
      `${path}.extractionPromptVersion`,
    ),
    verificationRuleVersion: nonEmptyString(
      input.verificationRuleVersion,
      `${path}.verificationRuleVersion`,
    ),
    verifiedAt,
  };
}

function parseTraceEvent(value: unknown, path: string): VerificationTraceEvent {
  const input = record(value, path);
  return {
    id: positiveInteger(input.id, `${path}.id`),
    eventId: nonEmptyString(input.eventId, `${path}.eventId`),
    sequenceNumber: positiveInteger(
      input.sequenceNumber,
      `${path}.sequenceNumber`,
    ),
    eventType: enumValue(
      input.eventType,
      TRACE_EVENT_TYPES,
      `${path}.eventType`,
    ) as TraceEventType,
    outcome: enumValue(
      input.outcome,
      TRACE_EVENT_OUTCOMES,
      `${path}.outcome`,
    ) as TraceEventOutcome,
    occurredAt: isoDate(input.occurredAt, `${path}.occurredAt`),
    target: nullableString(input.target, `${path}.target`),
    toolName: nullableString(input.toolName, `${path}.toolName`),
    filePath: nullableString(input.filePath, `${path}.filePath`),
    command: nullableString(input.command, `${path}.command`),
    workingDirectory: nullableString(
      input.workingDirectory,
      `${path}.workingDirectory`,
    ),
    exitCode: nullableInteger(input.exitCode, `${path}.exitCode`),
    testPassed: nullableNonNegativeInteger(
      input.testPassed,
      `${path}.testPassed`,
    ),
    testFailed: nullableNonNegativeInteger(
      input.testFailed,
      `${path}.testFailed`,
    ),
    testSkipped: nullableNonNegativeInteger(
      input.testSkipped,
      `${path}.testSkipped`,
    ),
    fileExistedBefore: nullableBoolean(
      input.fileExistedBefore,
      `${path}.fileExistedBefore`,
    ),
    fileExistsAfter: nullableBoolean(
      input.fileExistsAfter,
      `${path}.fileExistsAfter`,
    ),
    fileHashBefore: nullableHash(
      input.fileHashBefore,
      `${path}.fileHashBefore`,
    ),
    fileHashAfter: nullableHash(input.fileHashAfter, `${path}.fileHashAfter`),
    outputHash: nullableHash(input.outputHash, `${path}.outputHash`),
    previousEventHash: nullableHash(
      input.previousEventHash,
      `${path}.previousEventHash`,
    ),
    eventHash: hash(input.eventHash, `${path}.eventHash`),
    metadata: jsonObject(input.metadata, `${path}.metadata`),
  };
}

function parsePagination(value: unknown, path: string): VerificationPagination {
  const input = record(value, path);
  return {
    limit: positiveInteger(input.limit, `${path}.limit`),
    offset: nonNegativeInteger(input.offset, `${path}.offset`),
    returned: nonNegativeInteger(input.returned, `${path}.returned`),
  };
}

function assertClaimTotals(
  value: Pick<
    VerificationOverview,
    | "totalClaims"
    | "verifiedClaims"
    | "contradictedClaims"
    | "unsupportedClaims"
    | "unverifiableClaims"
    | "scoredClaims"
  >,
  path: string,
): void {
  if (
    value.totalClaims !==
    value.verifiedClaims +
      value.contradictedClaims +
      value.unsupportedClaims +
      value.unverifiableClaims
  ) {
    fail("claim counters do not add up to totalClaims", path);
  }
  if (
    value.scoredClaims !==
    value.verifiedClaims + value.contradictedClaims + value.unsupportedClaims
  ) {
    fail("scoreable counters do not add up to scoredClaims", path);
  }
}

function assertReturnedCount(
  pagination: VerificationPagination,
  length: number,
  path: string,
): void {
  if (pagination.returned !== length)
    fail("must equal the number of returned sessions", path);
}

function assertUnique(
  values: readonly (string | number)[],
  path: string,
  label: string,
): void {
  if (new Set(values).size !== values.length)
    fail(`${label}s must be unique`, path);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("expected an object", path);
  return value as Record<string, unknown>;
}

function array<T>(
  value: unknown,
  path: string,
  parser: (item: unknown, path: string) => T,
): readonly T[] {
  if (!Array.isArray(value)) fail("expected an array", path);
  return value.map((item, index) => parser(item, `${path}[${index}]`));
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "")
    fail("expected a non-empty string", path);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail("expected a string or null", path);
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  return array(value, path, (item, itemPath) => nonEmptyString(item, itemPath));
}

function enumValue(
  value: unknown,
  allowed: readonly string[],
  path: string,
): string {
  if (typeof value !== "string" || !allowed.includes(value))
    fail(`expected one of ${allowed.join(", ")}`, path);
  return value;
}

function nullableEnum(
  value: unknown,
  allowed: readonly string[],
  path: string,
): string | null {
  return value === null ? null : enumValue(value, allowed, path);
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    fail("expected a non-negative integer", path);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) fail("expected a positive integer", path);
  return parsed;
}

function nullableInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    fail("expected an integer or null", path);
  return value;
}

function nullableNonNegativeInteger(
  value: unknown,
  path: string,
): number | null {
  return value === null ? null : nonNegativeInteger(value, path);
}

function nullableBoolean(value: unknown, path: string): boolean | null {
  if (value !== null && typeof value !== "boolean")
    fail("expected a boolean or null", path);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("expected a boolean", path);
  return value;
}

function nullablePercent(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  )
    fail("expected a percentage from 0 through 100 or null", path);
  return value;
}

function isoDate(value: unknown, path: string): string {
  const text = nonEmptyString(value, path);
  if (Number.isNaN(Date.parse(text)))
    fail("expected an ISO-8601 timestamp", path);
  return text;
}

function nullableIsoDate(value: unknown, path: string): string | null {
  return value === null ? null : isoDate(value, path);
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value))
    fail("expected a lowercase SHA-256 hash", path);
  return value;
}

function nullableHash(value: unknown, path: string): string | null {
  return value === null ? null : hash(value, path);
}

function jsonObject(value: unknown, path: string): JsonObject {
  const input = record(value, path);
  return Object.fromEntries(
    Object.entries(input).map(([key, item]) => [
      key,
      jsonValue(item, `${path}.${key}`),
    ]),
  );
}

function jsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((item, index) => jsonValue(item, `${path}[${index}]`));
  if (typeof value === "object") return jsonObject(value, path);
  return fail("expected a JSON value", path);
}

function fail(message: string, path: string): never {
  throw new ContractValidationError(message, path);
}
