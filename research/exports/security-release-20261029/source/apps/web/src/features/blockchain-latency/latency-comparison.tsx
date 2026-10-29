"use client";

import { useEffect, useMemo, useState } from "react";
import type { BlockchainLatencyIdentity, BlockchainLatencyMeasurements } from "./latency-types";
import {
  getBlockchainLatencyStorageKey,
  readBlockchainLatencyMeasurements,
  subscribeToBlockchainLatencyChanges
} from "./latency-storage";
import styles from "./blockchain-latency.module.css";

export function BlockchainLatencyComparison({
  identity
}: Readonly<{ identity: BlockchainLatencyIdentity }>) {
  const [measurements, setMeasurements] = useState<BlockchainLatencyMeasurements>({});
  const { promptId, runId, claimIndex } = identity;
  const storageKey = useMemo(
    () => getBlockchainLatencyStorageKey({ promptId, runId, claimIndex }),
    [promptId, runId, claimIndex]
  );

  useEffect(() => {
    const refresh = () =>
      setMeasurements(readBlockchainLatencyMeasurements({ promptId, runId, claimIndex }));
    refresh();
    return subscribeToBlockchainLatencyChanges(storageKey, refresh);
  }, [promptId, runId, claimIndex, storageKey]);

  const sepolia = measurements.sepolia;
  const sui = measurements.sui;
  const fasterChain =
    sepolia && sui ? (sepolia.elapsedMs <= sui.elapsedMs ? "Sepolia" : "Sui Testnet") : null;
  const differenceMs = sepolia && sui ? Math.abs(sepolia.elapsedMs - sui.elapsedMs) : null;

  return (
    <article
      className={styles.comparison}
      aria-label={`Latency comparison for claim ${identity.claimIndex}`}
    >
      <header className={styles.heading}>
        <div>
          <span className={styles.claimLabel}>Claim {identity.claimIndex}</span>
          <h4>Transaction confirmation time</h4>
          <p>Wallet approval excluded.</p>
        </div>
      </header>
      <div className={styles.measurements}>
        <MeasurementRow
          label="Sepolia"
          measurement={sepolia}
          explorerUrl={
            sepolia
              ? `https://sepolia.etherscan.io/tx/${encodeURIComponent(sepolia.transactionId)}`
              : undefined
          }
        />
        <MeasurementRow
          label="Sui Testnet"
          measurement={sui}
          explorerUrl={
            sui
              ? `https://suiexplorer.com/txblock/${encodeURIComponent(sui.transactionId)}?network=testnet`
              : undefined
          }
        />
      </div>
      {fasterChain && differenceMs !== null ? (
        <p className={styles.result}>
          {differenceMs < 10
            ? `Similar in this run (difference ${formatDuration(differenceMs)}).`
            : `${fasterChain} completed ${formatDuration(differenceMs)} faster in this run.`}
        </p>
      ) : (
        <p className={styles.pending}>Anchor successfully on both chains to compare this claim.</p>
      )}
    </article>
  );
}

function MeasurementRow({
  label,
  measurement,
  explorerUrl
}: Readonly<{
  label: string;
  measurement: BlockchainLatencyMeasurements["sepolia"];
  explorerUrl?: string | undefined;
}>) {
  return (
    <div className={styles.measurement}>
      <span>{label}</span>
      {measurement ? (
        <>
          <strong>{formatDuration(measurement.elapsedMs)}</strong>
          <a href={explorerUrl} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </>
      ) : (
        <strong className={styles.empty}>Not recorded yet</strong>
      )}
    </div>
  );
}

function formatDuration(elapsedMs: number): string {
  return elapsedMs >= 60_000
    ? `${Math.floor(elapsedMs / 60_000)}m ${((elapsedMs % 60_000) / 1000).toFixed(2)}s`
    : `${(elapsedMs / 1000).toFixed(2)}s`;
}
