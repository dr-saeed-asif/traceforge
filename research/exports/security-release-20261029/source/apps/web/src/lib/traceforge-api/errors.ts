export const TRACEFORGE_API_ERROR_CODES = [
  "CONFIGURATION_ERROR",
  "INVALID_REQUEST",
  "TIMEOUT",
  "NETWORK_ERROR",
  "HTTP_ERROR",
  "INVALID_RESPONSE"
] as const;

export type TraceForgeApiErrorCode = (typeof TRACEFORGE_API_ERROR_CODES)[number];

export interface TraceForgeApiErrorOptions {
  readonly status?: number;
  readonly upstreamCode?: string;
  readonly cause?: unknown;
}

/** Safe error exposed to server-rendered frontend routes. */
export class TraceForgeApiError extends Error {
  public readonly status: number | null;
  public readonly upstreamCode: string | null;

  public constructor(
    public readonly code: TraceForgeApiErrorCode,
    message: string,
    options: TraceForgeApiErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TraceForgeApiError";
    this.status = options.status ?? null;
    this.upstreamCode = options.upstreamCode ?? null;
  }
}
