export type DomainErrorCode =
  | "INVALID_EVENT"
  | "INVALID_SEQUENCE"
  | "UNSUPPORTED_VALUE"
  | "INTEGRITY_FAILURE";

export class DomainError extends Error {
  public constructor(
    public readonly code: DomainErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "DomainError";
  }
}
