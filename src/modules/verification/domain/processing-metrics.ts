/** Wall-clock boundaries and monotonic durations for one processing attempt. */
export interface ProcessingMetrics {
  readonly extractorModel: string;
  readonly extractionStartedAt: string;
  readonly extractionCompletedAt: string | null;
  readonly extractionDurationMs: number | null;
  /** Extractor call only, including any LLM repair; excludes persistence. */
  readonly extractorDurationMs?: number | null;
  readonly verificationStartedAt: string | null;
  readonly verificationCompletedAt: string | null;
  readonly verificationDurationMs: number | null;
}
