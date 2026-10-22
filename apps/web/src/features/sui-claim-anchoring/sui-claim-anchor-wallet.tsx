"use client";

import { useState } from "react";
import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { Button } from "@/components/ui";
import type {
  VerificationClaim,
  VerificationSession,
  VerificationTraceEvent
} from "@traceforge/verification-contracts";
import {
  getSuiAnchorDeployment,
  createSuiAnchorTransaction,
  getSuiTestnetTransactionUrl
} from "./sui-anchor-client";
import { suiDAppKit } from "./sui-dapp-kit";
import styles from "./sui-claim-anchoring.module.css";
import { recordBlockchainLatencyMeasurement } from "../blockchain-latency/latency-storage";

export function SuiClaimAnchorWallet({
  session,
  claim,
  traceEvents
}: Readonly<{
  session: VerificationSession;
  claim: VerificationClaim;
  traceEvents: readonly VerificationTraceEvent[];
}>) {
  const dAppKit = useDAppKit(suiDAppKit);
  const account = useCurrentAccount({ dAppKit: suiDAppKit });
  const wallets = useWallets({ dAppKit: suiDAppKit });
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [digest, setDigest] = useState("");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [anchored, setAnchored] = useState(false);
  const [walletChoicesOpen, setWalletChoicesOpen] = useState(false);

  async function handleAnchor() {
    setMessage("");
    setDigest("");
    setElapsedMs(null);
    setAnchored(false);

    try {
      const deployment = getSuiAnchorDeployment();
      if (claim.verdict !== "VERIFIED") {
        throw new Error("Only verified claims can be anchored on Sui.");
      }
      if (!account) {
        const testnetWallets = wallets.filter((wallet) => wallet.chains.includes("sui:testnet"));
        if (testnetWallets.length === 0) {
          setMessage(
            "No Sui testnet wallet found. Install or enable a Wallet Standard Sui wallet, then try again."
          );
        } else if (testnetWallets.length === 1) {
          await connectWallet(testnetWallets[0]);
        } else {
          setWalletChoicesOpen(true);
        }
        return;
      }
      if (!account.chains.includes("sui:testnet")) {
        throw new Error("Switch your Sui wallet to Testnet, then try again.");
      }

      setBusy(true);
      setMessage("Review and approve the Sui Testnet transaction in your wallet.");
      const startedAt = performance.now();
      const transaction = await createSuiAnchorTransaction(session, claim, traceEvents, deployment);
      const result = await dAppKit.signAndExecuteTransaction({
        transaction,
        account,
        network: "testnet"
      });
      const elapsed = Math.round(performance.now() - startedAt);

      if (result.$kind === "FailedTransaction") {
        throw new Error(
          describeSuiError(result.FailedTransaction.status.error) ??
            "Sui rejected the anchoring transaction."
        );
      }
      if (!result.Transaction.status.success) {
        throw new Error(
          describeSuiError(result.Transaction.status.error) ?? "Sui did not confirm the anchor."
        );
      }

      setDigest(result.Transaction.digest);
      setElapsedMs(elapsed);
      recordBlockchainLatencyMeasurement(
        { promptId: session.promptId, runId: session.runId, claimIndex: claim.claimIndex },
        "sui",
        elapsed,
        result.Transaction.digest
      );
      setAnchored(true);
      setMessage("Confirmed on Sui Testnet. The verified-claim commitment is anchored.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The Sui transaction could not be submitted."
      );
    } finally {
      setBusy(false);
    }
  }

  async function connectWallet(wallet: (typeof wallets)[number] | undefined) {
    if (!wallet) return;
    setConnecting(true);
    try {
      const account = wallet.accounts.find((candidate) => candidate.chains.includes("sui:testnet"));
      await dAppKit.connectWallet({ wallet, ...(account ? { account } : {}) });
      setWalletChoicesOpen(false);
      setMessage("Sui wallet connected. Click Anchor on Sui again to submit the claim commitment.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect the Sui wallet.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className={styles.suiAnchor}>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || connecting || anchored}
        onClick={handleAnchor}
      >
        {busy
          ? "Waiting for Sui…"
          : connecting
            ? "Connecting wallet…"
            : anchored
              ? "Anchored on Sui"
              : "Anchor on Sui"}
      </Button>
      {walletChoicesOpen ? (
        <div className={styles.walletChoices} aria-label="Choose a Sui testnet wallet">
          <strong>Choose a Sui testnet wallet</strong>
          {wallets
            .filter((wallet) => wallet.chains.includes("sui:testnet"))
            .map((wallet) => (
              <Button
                key={wallet.name}
                size="sm"
                variant="secondary"
                disabled={connecting}
                onClick={() => void connectWallet(wallet)}
              >
                {wallet.name}
              </Button>
            ))}
        </div>
      ) : null}
      {message ? (
        <span className={styles.suiMessage} role="status">
          {message}
        </span>
      ) : null}
      {account ? <span className={styles.suiMessage}>Wallet: {account.address}</span> : null}
      {elapsedMs !== null ? (
        <span className={styles.suiMessage}>
          End-to-end time: {(elapsedMs / 1000).toFixed(2)} s (wallet approval + Sui execution)
        </span>
      ) : null}
      {digest ? (
        <a
          className={styles.suiLink}
          href={getSuiTestnetTransactionUrl(digest)}
          target="_blank"
          rel="noreferrer"
        >
          View Sui transaction
        </a>
      ) : null}
    </div>
  );
}

function describeSuiError(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return null;
  if ("message" in error && typeof error.message === "string") return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return null;
  }
}
