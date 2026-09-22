import "server-only";
import { TraceForgeApiError } from "./errors";

export const DEFAULT_TRACEFORGE_API_TIMEOUT_MS = 8_000;
export const MAX_TRACEFORGE_API_TIMEOUT_MS = 60_000;

export interface TraceForgeApiConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs: number;
}

export function loadTraceForgeApiConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): TraceForgeApiConfig {
  const baseUrl = required(environment.TRACEFORGE_API_URL, "TRACEFORGE_API_URL");
  const token = required(environment.TRACEFORGE_API_TOKEN, "TRACEFORGE_API_TOKEN");
  if (token.length < 16)
    configurationError("TRACEFORGE_API_TOKEN must contain at least 16 characters");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return configurationError("TRACEFORGE_API_URL must be an absolute URL");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    configurationError("TRACEFORGE_API_URL must use http: or https:");
  }

  const timeoutMs = Number(
    environment.TRACEFORGE_API_TIMEOUT_MS ?? DEFAULT_TRACEFORGE_API_TIMEOUT_MS
  );
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TRACEFORGE_API_TIMEOUT_MS
  ) {
    configurationError(
      `TRACEFORGE_API_TIMEOUT_MS must be an integer from 1 through ${MAX_TRACEFORGE_API_TIMEOUT_MS}`
    );
  }

  return {
    baseUrl: parsedUrl.toString().replace(/\/$/u, ""),
    token,
    timeoutMs
  };
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) return configurationError(`${name} is required`);
  return value.trim();
}

function configurationError(message: string): never {
  throw new TraceForgeApiError("CONFIGURATION_ERROR", message);
}
