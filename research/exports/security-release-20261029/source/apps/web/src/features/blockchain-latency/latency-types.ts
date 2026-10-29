export const BLOCKCHAIN_LATENCY_CHAINS = ["sepolia", "sui"] as const;

export type BlockchainLatencyChain = (typeof BLOCKCHAIN_LATENCY_CHAINS)[number];

export interface BlockchainLatencyMeasurement {
  readonly chain: BlockchainLatencyChain;
  readonly elapsedMs: number;
  readonly transactionId: string;
  readonly recordedAt: string;
}

export interface BlockchainLatencyMeasurements {
  readonly sepolia?: BlockchainLatencyMeasurement;
  readonly sui?: BlockchainLatencyMeasurement;
}

export interface BlockchainLatencyIdentity {
  readonly promptId: string;
  readonly runId: string;
  readonly claimIndex: number;
}
