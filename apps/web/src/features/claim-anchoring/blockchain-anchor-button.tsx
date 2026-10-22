"use client";

import { useState } from "react";
import type {
  VerificationClaim,
  VerificationSession,
  VerificationTraceEvent
} from "@traceforge/verification-contracts";
import { Button } from "@/components/ui";
import {
  anchorVerifiedClaim,
  getSepoliaContractUrl,
  getSepoliaDeploymentUrl,
  getSepoliaTransactionUrl,
  verifyVerifiedClaimAnchor
} from "./blockchain-anchor-client";
import styles from "./claim-anchoring.module.css";
import { recordBlockchainLatencyMeasurement } from "../blockchain-latency/latency-storage";

export function BlockchainAnchorButton({
  session,
  claim,
  traceEvents
}: Readonly<{
  session: VerificationSession;
  claim: VerificationClaim;
  traceEvents: readonly VerificationTraceEvent[];
}>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [transactionUrl, setTransactionUrl] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [blockNumber, setBlockNumber] = useState<string | null>(null);
  const [anchored, setAnchored] = useState(false);
  const [pending, setPending] = useState(false);
  const [integrityVerified, setIntegrityVerified] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  async function handleAnchor() {
    setBusy(true);
    setPending(false);
    setMessage("Connect MetaMask and approve the Sepolia transaction when prompted.");
    setTransactionUrl("");
    setTransactionHash("");
    setBlockNumber(null);
    setElapsedMs(null);
    const startedAt = performance.now();
    try {
      const result = await anchorVerifiedClaim(session, claim, traceEvents);
      const elapsed = Math.round(performance.now() - startedAt);
      if (result.txHash) {
        setTransactionHash(result.txHash);
        setTransactionUrl(getSepoliaTransactionUrl(result.txHash));
      }
      setBlockNumber(result.blockNumber);
      if (result.status === "already-anchored") {
        setAnchored(true);
        setMessage("This claim is already anchored on Sepolia.");
        return;
      }

      setAnchored(result.status === "confirmed");
      setPending(result.status === "pending");
      if (result.status === "confirmed" && result.txHash) {
        setElapsedMs(elapsed);
        recordBlockchainLatencyMeasurement(
          { promptId: session.promptId, runId: session.runId, claimIndex: claim.claimIndex },
          "sepolia",
          elapsed,
          result.txHash
        );
      }
      setMessage(
        result.status === "confirmed"
          ? "Confirmed on Sepolia. The claim commitment is anchored."
          : "Submitted to Sepolia; confirmation is taking longer. Check the transaction link."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The blockchain transaction could not be submitted."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setBusy(true);
    setIntegrityVerified(false);
    setMessage("Recomputing claim and evidence hashes, then checking Sepolia…");
    try {
      const result = await verifyVerifiedClaimAnchor(session, claim, traceEvents);
      if (!result.recordFound) {
        setMessage("No matching anchor was found on Sepolia. Anchor this verified claim first.");
        return;
      }
      if (!result.matches) {
        setMessage(`Integrity check failed. Mismatched fields: ${result.mismatches.join(", ")}.`);
        return;
      }

      setIntegrityVerified(true);
      setAnchored(true);
      setMessage(
        `Integrity verified on Sepolia. Record ${result.recordId}; anchored at ${new Date(Number(result.anchoredAt) * 1000).toLocaleString()}.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The on-chain integrity check could not be completed."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.blockchainAnchor}>
      <Button
        size="sm"
        variant={anchored ? "secondary" : "primary"}
        disabled={busy || anchored || pending}
        onClick={handleAnchor}
      >
        {busy
          ? "Waiting for Sepolia…"
          : anchored
            ? "Anchored"
            : pending
              ? "Transaction pending"
              : "Anchor on Sepolia"}
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={handleVerify}>
        {busy && message.startsWith("Recomputing")
          ? "Checking Sepolia…"
          : integrityVerified
            ? "Integrity verified"
            : "Verify on Sepolia"}
      </Button>
      {message ? (
        <span className={styles.blockchainAnchorMessage} role="status">
          {message}
        </span>
      ) : null}
      {transactionHash ? (
        <span className={styles.blockchainAnchorMessage}>
          Network: Sepolia
          {blockNumber ? ` · Block ${blockNumber}` : pending ? " · Awaiting block" : ""}
          <br />
          Transaction: {transactionHash}
        </span>
      ) : null}
      {elapsedMs !== null ? (
        <span className={styles.blockchainAnchorMessage}>
          End-to-end time: {(elapsedMs / 1000).toFixed(2)} s (wallet approval + Sepolia
          confirmation)
        </span>
      ) : null}
      {transactionUrl ? (
        <a
          className={styles.blockchainAnchorLink}
          href={transactionUrl}
          target="_blank"
          rel="noreferrer"
        >
          View transaction
        </a>
      ) : null}
      <a
        className={styles.blockchainAnchorLink}
        href={getSepoliaContractUrl()}
        target="_blank"
        rel="noreferrer"
      >
        Contract
      </a>
      <a
        className={styles.blockchainAnchorLink}
        href={getSepoliaDeploymentUrl()}
        target="_blank"
        rel="noreferrer"
      >
        Deployment transaction
      </a>
    </div>
  );
}
