import type { CanonicalJsonValue } from "@traceforge/crypto";
import { RedactionPolicy } from "@traceforge/provenance";
import { CollectorError } from "../errors/collector-error.js";

const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|private[_-]?key|database[_-]?url)$/iu;

export function redactJson(value: unknown, policy: RedactionPolicy, path = "$"): CanonicalJsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return policy.redact(value).value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CollectorError("INVALID_INPUT", `Non-finite number at ${path}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => redactJson(item, policy, `${path}[${index}]`));
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CollectorError("INVALID_INPUT", `Unsupported object at ${path}`);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) && typeof item === "string"
        ? "[REDACTED]"
        : redactJson(item, policy, `${path}.${key}`)
    ]));
  }
  throw new CollectorError("INVALID_INPUT", `Unsupported ${typeof value} at ${path}`);
}
