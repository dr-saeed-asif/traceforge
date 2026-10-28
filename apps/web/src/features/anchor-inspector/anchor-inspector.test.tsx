import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  createBlockchainClaimAnchorManifest,
  createBlockchainClaimAnchorPayload
} from "@traceforge/claim-anchoring";
import type { VerificationSessionDetailsResponse } from "@traceforge/verification-contracts";
import { encodeFunctionData, type Abi } from "viem";
import abi from "@traceforge/claim-anchoring/abi";
import { AnchorInspector } from "./anchor-inspector";

const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@/features/claim-anchoring/blockchain-anchor-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  verifyVerifiedClaimAnchor: mocks.verify
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const details: VerificationSessionDetailsResponse = {
  session: {
    promptId: "p",
    promptQuery: "Create file",
    externalSessionId: "s",
    runId: "r",
    projectName: "Fixture",
    projectPath: "/fixture",
    agentName: "OpenCode",
    modelName: "agent",
    executionStatus: "COMPLETED",
    extractionStatus: "SUCCEEDED",
    verificationStatus: "SUCCEEDED",
    totalClaims: 1,
    verifiedClaims: 1,
    contradictedClaims: 0,
    unsupportedClaims: 0,
    unverifiableClaims: 0,
    scoredClaims: 1,
    reliabilityPercent: 100,
    coveragePercent: 100,
    startedAt: "2026-10-23T10:00:00.000Z",
    completedAt: "2026-10-23T10:01:00.000Z"
  },
  claims: [
    {
      claimIndex: 2,
      claimText: "Created file",
      claimType: "FILE_CREATED",
      target: "a.js",
      expectedResult: "File exists",
      verdict: "VERIFIED",
      reasonCode: "REQUIRED_EVIDENCE_CONFIRMED",
      explanation: "Fixture",
      evidenceEventIds: [],
      extractorModel: "extractor",
      extractionPromptVersion: "1",
      verificationRuleVersion: "1",
      verifiedAt: "2026-10-23T10:01:00.000Z"
    }
  ],
  traceEvents: []
};

it("keeps decoded-field matching separate from reading the actual stored anchor", async () => {
  const expected = await createBlockchainClaimAnchorPayload(
    createBlockchainClaimAnchorManifest(details.session, details.claims[0]!, details.traceEvents, 1)
  );
  const input = encodeFunctionData({
    abi: abi as Abi,
    functionName: "anchorVerifiedClaim",
    args: [expected.sessionHash, 2, expected.manifestHash, expected.evidenceRoot, 1]
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.startsWith("/api/anchor-lookup") ? { matches: [] } : details)
    }))
  );
  mocks.verify.mockResolvedValue({ matches: true });
  render(<AnchorInspector initialPromptId="p" initialClaimIndex="2" />);
  fireEvent.change(screen.getByLabelText("Transaction input data"), { target: { value: input } });
  fireEvent.click(screen.getByRole("button", { name: "Decode input" }));
  expect(screen.getByRole("button", { name: "Check stored anchor" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Load claim and recompute hashes" }));
  await waitFor(() =>
    expect(screen.getByText(/All five decoded fields match/)).toBeInTheDocument()
  );
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(screen.getAllByText("Match")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "Check stored anchor" }));
  await waitFor(() =>
    expect(screen.getByText(/Stored Sepolia commitment matches/)).toBeInTheDocument()
  );
  fireEvent.change(screen.getByLabelText("Transaction input data"), { target: { value: "0x00" } });
  expect(screen.getByRole("button", { name: "Check stored anchor" })).toBeDisabled();
  expect(screen.queryByText(/Stored Sepolia commitment matches/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Decode input" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Expected 164 bytes");
});
