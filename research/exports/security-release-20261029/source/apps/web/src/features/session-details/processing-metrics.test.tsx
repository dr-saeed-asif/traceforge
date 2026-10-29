import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { VerificationSession } from "@traceforge/verification-contracts";
import { ProcessingMetricsPanel } from "./processing-metrics";

afterEach(() => vi.useRealTimers());

const session = {
  modelName: "coding-agent",
  executionStatus: "COMPLETED",
  extractionStatus: "PENDING",
  verificationStatus: "NOT_STARTED",
  startedAt: "2026-10-23T10:00:00.000Z",
  completedAt: "2026-10-23T10:00:05.000Z",
  processingMetrics: {
    extractorModel: "local-extractor",
    extractionStartedAt: "2026-10-23T10:00:05.000Z",
    extractionCompletedAt: null,
    extractionDurationMs: null,
    verificationStartedAt: null,
    verificationCompletedAt: null,
    verificationDurationMs: null
  }
} as VerificationSession;

it("shows separate models and updates the active extraction timer", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T10:00:10.000Z"));
  const view = render(<ProcessingMetricsPanel session={session} />);
  expect(screen.getByText("coding-agent")).toBeInTheDocument();
  expect(screen.getByText("local-extractor")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Extracting claims");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getAllByText("6.0 s")).toHaveLength(2);
  view.rerender(
    <ProcessingMetricsPanel
      session={{
        ...session,
        extractionStatus: "SUCCEEDED",
        verificationStatus: "SUCCEEDED",
        processingMetrics: {
          ...session.processingMetrics!,
          extractionDurationMs: 6500,
          extractionCompletedAt: "2026-10-23T10:00:11.500Z",
          verificationDurationMs: 20
        }
      }}
    />
  );
  expect(screen.getByText("6.5 s")).toBeInTheDocument();
  expect(screen.getByText("20 ms")).toBeInTheDocument();
  expect(screen.getByText("Deterministic rules (no LLM)")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Processing complete");
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText("6.5 s")).toBeInTheDocument();
});

it("does not invent metrics for historical sessions", () => {
  render(
    <ProcessingMetricsPanel
      session={{
        ...session,
        extractionStatus: "SUCCEEDED",
        verificationStatus: "SUCCEEDED",
        processingMetrics: null
      }}
    />
  );
  expect(screen.getByText("Not recorded yet")).toBeInTheDocument();
  expect(screen.getAllByText("Not recorded")).toHaveLength(4);
});
