/** Lifecycle of one prompt/query, not the containing OpenCode chat session. */
export const EXECUTION_STATUSES = ["IN_PROGRESS", "COMPLETED", "FAILED", "INTERRUPTED"] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** Shared lifecycle for asynchronous extraction and verification work. */
export const PROCESSING_STATUSES = ["NOT_STARTED", "PENDING", "SUCCEEDED", "FAILED"] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

const executionStatusValues = new Set<string>(EXECUTION_STATUSES);
const processingStatusValues = new Set<string>(PROCESSING_STATUSES);

export function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return typeof value === "string" && executionStatusValues.has(value);
}

export function isProcessingStatus(value: unknown): value is ProcessingStatus {
  return typeof value === "string" && processingStatusValues.has(value);
}
