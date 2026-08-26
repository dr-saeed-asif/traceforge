export type SdkErrorCode = "RUN_COMPLETED" | "RUN_ALREADY_COMPLETED" | "INVALID_ARGUMENT";

export class TraceSdkError extends Error {
  public constructor(public readonly code: SdkErrorCode, message: string) {
    super(message);
    this.name = "TraceSdkError";
  }
}
