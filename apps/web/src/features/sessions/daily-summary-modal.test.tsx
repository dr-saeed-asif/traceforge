import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { VerificationSession } from "@traceforge/verification-contracts";
import { DailySummaryModal } from "./daily-summary-modal";

vi.mock("@/features/claim-anchoring/blockchain-anchor-button", () => ({
  BlockchainAnchorButton: () => null
}));
vi.mock("@/features/sui-claim-anchoring/sui-claim-anchor-button", () => ({
  SuiClaimAnchorButton: () => null
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("refreshes an active query without collapsing it and stops after processing completes", async () => {
  vi.useFakeTimers();
  const session = {
    promptId: "prompt-live",
    promptQuery: "Create calculator",
    agentName: "OpenCode",
    modelName: "agent-model",
    startedAt: "2026-10-23T10:00:00.000Z",
    completedAt: "2026-10-23T10:00:10.000Z",
    executionStatus: "COMPLETED",
    extractionStatus: "PENDING",
    verificationStatus: "NOT_STARTED",
    totalClaims: 0
  } as VerificationSession;
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session, claims: [], traceEvents: [] })
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session: { ...session, extractionStatus: "SUCCEEDED", verificationStatus: "SUCCEEDED" },
        claims: [],
        traceEvents: []
      })
    });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <DailySummaryModal
      isOpen
      onClose={() => undefined}
      day={{
        date: "2026-10-23",
        dateDisplay: "Oct 23, 2026",
        sessions: [session],
        queries: 1,
        totalClaims: 0,
        verifiedClaims: 0,
        contradictedClaims: 0,
        unsupportedClaims: 0,
        unverifiableClaims: 0,
        reliabilityPercent: null
      }}
    />
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  fireEvent.click(screen.getByRole("button", { name: "Expand" }));
  expect(
    screen.getByText("Claims will appear after the final response has been extracted.")
  ).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
  expect(screen.getByText("Processing complete.")).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
