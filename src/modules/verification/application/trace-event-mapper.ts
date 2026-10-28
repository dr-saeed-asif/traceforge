import { createHash } from "node:crypto";
import type { TraceEventProjections } from "./ports/verification-repository.js";
import {
  isTraceEventType,
  type TraceEventOutcome,
  type TraceEventType,
} from "../domain/trace-event-types.js";

export interface CaptureEventEnvelope {
  readonly eventType: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface TraceEventMapping {
  readonly eventType: TraceEventType;
  readonly outcome: TraceEventOutcome;
  readonly target?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly projections?: TraceEventProjections;
}

/**
 * Converts provider-oriented capture events into the stable Phase 1 vocabulary.
 * Unknown provider events remain in the legacy journal but are not silently
 * treated as verification evidence.
 */
export function mapCaptureEventToTraceEvent(
  input: CaptureEventEnvelope,
): TraceEventMapping | null {
  const payload = input.payload ?? {};
  const eventType = canonicalEventType(input.eventType, payload);
  if (!eventType) return null;

  const target =
    firstString(payload, ["target", "filePath", "path"]) ??
    (isCommandEvent(eventType)
      ? firstString(payload, ["command", "cmd"])
      : undefined);
  const mapping: TraceEventMapping = {
    eventType,
    outcome: outcomeFor(input.eventType, eventType, payload),
    metadata: sanitizeMetadata(payload),
    ...(target ? { target } : {}),
  };
  const projections = projectionsFor(payload);
  return Object.keys(projections).length === 0
    ? mapping
    : { ...mapping, projections };
}

function canonicalEventType(
  sourceEventType: string,
  payload: Readonly<Record<string, unknown>>,
): TraceEventType | null {
  switch (sourceEventType) {
    case "PROMPT_RECEIVED":
    case "PROMPT_SUBMITTED":
      return "PROMPT_SUBMITTED";
    case "MODEL_REQUEST":
    case "MODEL_REQUESTED":
      return "MODEL_REQUESTED";
    case "MODEL_RESPONSE":
    case "FINAL_RESPONSE":
    case "FINAL_RESPONSE_CAPTURED":
      return "FINAL_RESPONSE_CAPTURED";
    case "GENERATED_CODE_CAPTURED":
    case "WORKSPACE_FILE_CHANGED":
      return fileEventType(payload);
    case "COMMAND_COMPLETED":
      return commandEventType(payload) ?? "COMMAND_COMPLETED";
    case "TEST_PASSED":
      return "TEST_COMPLETED";
    case "BUILD_PASSED":
      return "BUILD_COMPLETED";
    case "ARCHITECTURE_CHECK":
      return "ARCHITECTURE_CHECK_COMPLETED";
    default:
      return isCanonicalEventType(sourceEventType) ? sourceEventType : null;
  }
}

function fileEventType(
  payload: Readonly<Record<string, unknown>>,
): TraceEventType {
  const before = booleanValue(
    payload.fileExistedBefore ?? payload.existedBefore,
  );
  const after = booleanValue(payload.fileExistsAfter ?? payload.existsAfter);
  if (before === false && after === true) return "FILE_CREATED";
  if (before === true && after === false) return "FILE_DELETED";
  return "FILE_MODIFIED";
}

function commandEventType(
  payload: Readonly<Record<string, unknown>>,
): TraceEventType | null {
  const command = firstString(payload, ["command", "cmd"]);
  if (!command) return null;
  if (
    /\b(?:npm\s+(?:run\s+)?test|node\b[^\r\n]*\s--test\b|vitest|jest|pytest|phpunit|cargo\s+test|go\s+test)\b/iu.test(
      command,
    )
  ) {
    return "TEST_COMPLETED";
  }
  if (
    /\b(?:npm\s+run\s+build|pnpm\s+(?:run\s+)?build|yarn\s+build|tsc|webpack|vite\s+build|cargo\s+build|go\s+build)\b/iu.test(
      command,
    )
  ) {
    return "BUILD_COMPLETED";
  }
  return null;
}

function outcomeFor(
  sourceEventType: string,
  eventType: TraceEventType,
  payload: Readonly<Record<string, unknown>>,
): TraceEventOutcome {
  const status = firstString(payload, ["status", "outcome"])?.toUpperCase();
  const exitCode = numberValue(payload.exitCode ?? payload.code);
  if (
    sourceEventType.endsWith("FAILED") ||
    ["FAILED", "ERROR", "CANCELLED", "INTERRUPTED"].includes(status ?? "") ||
    (exitCode !== undefined && exitCode !== 0)
  ) {
    return "FAILED";
  }
  if (
    ["SUCCEEDED", "SUCCESS", "PASSED", "COMPLETED", "OK"].includes(
      status ?? "",
    ) ||
    exitCode === 0 ||
    eventType === "FILE_CREATED" ||
    eventType === "FILE_MODIFIED" ||
    eventType === "FILE_DELETED" ||
    eventType === "TEST_COMPLETED" ||
    eventType === "BUILD_COMPLETED"
  ) {
    return "SUCCEEDED";
  }
  return "RECORDED";
}

function sanitizeMetadata(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const metadata: Record<string, unknown> = { ...payload };
  for (const [sourceKey, hashKey, lengthKey] of [
    ["content", "contentHash", "contentLength"],
    ["responseText", "responseHash", "responseLength"],
    ["output", "outputHash", "outputLength"],
    ["code", "codeHash", "codeLength"],
  ] as const) {
    const text =
      typeof metadata[sourceKey] === "string"
        ? (metadata[sourceKey] as string)
        : undefined;
    if (text !== undefined) {
      metadata[hashKey] = sha256(text);
      metadata[lengthKey] = text.length;
      delete metadata[sourceKey];
    }
  }
  return metadata;
}

function projectionsFor(
  payload: Readonly<Record<string, unknown>>,
): TraceEventProjections {
  const projections: TraceEventProjections = {};
  const toolName = firstString(payload, ["toolName", "tool"]);
  const filePath = firstString(payload, ["filePath", "path"]);
  const command = firstString(payload, ["command", "cmd"]);
  const workingDirectory = firstString(payload, [
    "workingDirectory",
    "cwd",
    "directory",
  ]);
  const exitCode = numberValue(payload.exitCode ?? payload.code);
  const testPassed = numberValue(
    payload.passed ?? payload.testPassed ?? payload.testsPassed,
  );
  const testFailed = numberValue(
    payload.failed ?? payload.testFailed ?? payload.testsFailed,
  );
  const testSkipped = numberValue(
    payload.skipped ?? payload.testSkipped ?? payload.testsSkipped,
  );
  const fileExistedBefore = booleanValue(
    payload.fileExistedBefore ?? payload.existedBefore,
  );
  const fileExistsAfter = booleanValue(
    payload.fileExistsAfter ?? payload.existsAfter,
  );
  const fileHashBefore = firstString(payload, ["fileHashBefore", "beforeHash"]);
  const fileHashAfter = firstString(payload, ["fileHashAfter", "afterHash"]);
  const outputHash =
    firstString(payload, ["outputHash"]) ??
    (typeof payload.output === "string" ? sha256(payload.output) : undefined);

  return {
    ...(toolName ? { toolName } : {}),
    ...(filePath ? { filePath } : {}),
    ...(command ? { command } : {}),
    ...(workingDirectory ? { workingDirectory } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(testPassed !== undefined ? { testPassed } : {}),
    ...(testFailed !== undefined ? { testFailed } : {}),
    ...(testSkipped !== undefined ? { testSkipped } : {}),
    ...(fileExistedBefore !== undefined ? { fileExistedBefore } : {}),
    ...(fileExistsAfter !== undefined ? { fileExistsAfter } : {}),
    ...(fileHashBefore ? { fileHashBefore } : {}),
    ...(fileHashAfter ? { fileHashAfter } : {}),
    ...(outputHash ? { outputHash } : {}),
  };
}

function isCanonicalEventType(value: string): value is TraceEventType {
  return isTraceEventType(value);
}

function isCommandEvent(eventType: TraceEventType): boolean {
  return (
    eventType === "COMMAND_STARTED" ||
    eventType === "COMMAND_COMPLETED" ||
    eventType === "BUILD_COMPLETED" ||
    eventType === "TEST_COMPLETED"
  );
}

function firstString(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "")
      return candidate.trim();
  }
  return undefined;
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
