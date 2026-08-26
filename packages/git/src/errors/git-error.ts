export class GitProvenanceError extends Error {
  public constructor(
    public readonly code: "INVALID_COMMIT" | "GIT_COMMAND_FAILED" | "INVALID_OUTPUT",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "GitProvenanceError";
  }
}
