import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VerificationClaim, VerificationSession } from "@traceforge/verification-contracts";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  sign: vi.fn(),
  execute: vi.fn(),
  latency: vi.fn()
}));
vi.mock("@mysten/dapp-kit-react", () => ({
  useDAppKit: () => ({
    getClient: () => ({ executeTransaction: mocks.execute }),
    signTransaction: mocks.sign
  }),
  useCurrentAccount: () => ({ address: "0x123", chains: ["sui:testnet"] }),
  useWallets: () => []
}));
vi.mock("./sui-dapp-kit", () => ({ suiDAppKit: {} }));
vi.mock("@traceforge/claim-anchoring", () => ({
  createBlockchainClaimAnchorManifest: () => ({}),
  createBlockchainClaimAnchorPayload: async () => ({})
}));
vi.mock("./sui-anchor-client", () => ({
  getSuiAnchorDeployment: () => ({}),
  buildSuiAnchorTransaction: () => ({}),
  findSuiClaimAnchor: mocks.lookup,
  getSuiTestnetTransactionUrl: (digest: string) =>
    `https://suiexplorer.com/txblock/${digest}?network=testnet`
}));
vi.mock("../blockchain-latency/latency-storage", () => ({
  recordBlockchainLatencyMeasurement: mocks.latency
}));

import { SuiClaimAnchorWallet } from "./sui-claim-anchor-wallet";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        nonce: "0x00",
        deadlineMs: 1000,
        signature: "0x00",
        signerPublicKey: "0x00"
      })
    }))
  );
  mocks.sign.mockResolvedValue({ bytes: "AA==", signature: "signed" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("measures Sui submission after signing, excluding a slow wallet approval", async () => {
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  mocks.lookup.mockResolvedValue(null);
  mocks.sign.mockImplementation(async () => {
    clock += 60000;
    return { bytes: "AA==", signature: "signed" };
  });
  mocks.execute.mockImplementation(async () => {
    clock += 250;
    return {
      $kind: "Transaction",
      Transaction: { status: { success: true }, digest: "new-digest" }
    };
  });
  renderWallet();
  fireEvent.click(screen.getByRole("button", { name: "Anchor on Sui" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Anchored on Sui" })).toBeDisabled()
  );
  expect(
    screen.getByText("Transaction confirmation time: 0.25 s (wallet approval excluded)")
  ).toBeInTheDocument();
  expect(mocks.latency).toHaveBeenCalledWith(expect.anything(), "sui", 250, "new-digest");
  expect(mocks.execute).toHaveBeenCalledWith({
    transaction: new Uint8Array([0]),
    signatures: ["signed"]
  });
});

function renderWallet() {
  return render(
    <SuiClaimAnchorWallet
      session={{} as VerificationSession}
      claim={{ verdict: "VERIFIED" } as VerificationClaim}
      traceEvents={[]}
    />
  );
}

it("reuses a matching on-chain anchor without opening a wallet or recording new latency", async () => {
  mocks.lookup.mockResolvedValue({
    matches: true,
    digest: "original-digest",
    objectUrl: "https://suiexplorer.com/object/record?network=testnet"
  });
  renderWallet();
  fireEvent.click(screen.getByRole("button", { name: "Anchor on Sui" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Anchored on Sui" })).toBeDisabled()
  );
  expect(screen.getByRole("link", { name: "View Sui transaction" })).toHaveAttribute(
    "href",
    expect.stringContaining("original-digest")
  );
  expect(mocks.sign).not.toHaveBeenCalled();
  expect(mocks.latency).not.toHaveBeenCalled();
});

it("blocks a conflicting immutable record and provides its explorer link", async () => {
  mocks.lookup.mockResolvedValue({
    matches: false,
    digest: "old",
    objectUrl: "https://suiexplorer.com/object/record?network=testnet"
  });
  renderWallet();
  fireEvent.click(screen.getByRole("button", { name: "Anchor on Sui" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("commitment differs"));
  expect(screen.getByRole("link", { name: "View stored Sui anchor" })).toBeInTheDocument();
  expect(mocks.sign).not.toHaveBeenCalled();
});

it("does not submit when the preflight RPC is unavailable", async () => {
  mocks.lookup.mockRejectedValue(new Error("RPC unavailable"));
  renderWallet();
  fireEvent.click(screen.getByRole("button", { name: "Anchor on Sui" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("RPC unavailable"));
  expect(mocks.sign).not.toHaveBeenCalled();
});

it("recovers a duplicate submission race only after verifying the stored commitment", async () => {
  mocks.lookup.mockResolvedValueOnce(null).mockResolvedValueOnce({
    matches: true,
    digest: "other-tab-digest",
    objectUrl: "https://suiexplorer.com/object/record?network=testnet"
  });
  mocks.execute.mockRejectedValue(new Error("MoveAbort abort code: 2"));
  renderWallet();
  fireEvent.click(screen.getByRole("button", { name: "Anchor on Sui" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Anchored on Sui" })).toBeDisabled()
  );
  expect(mocks.lookup).toHaveBeenCalledTimes(2);
  expect(mocks.latency).not.toHaveBeenCalled();
});
