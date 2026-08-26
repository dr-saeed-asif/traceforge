export type CollectorErrorCode =
  | "INVALID_INPUT"
  | "BACKPRESSURE"
  | "SEQUENCE_CONFLICT"
  | "NOT_RUNNING";

export class CollectorError extends Error {
  public constructor(public readonly code: CollectorErrorCode, message: string) {
    super(message);
    this.name = "CollectorError";
  }
}
