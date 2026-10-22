import type {
  BlockchainLatencyChain,
  BlockchainLatencyIdentity,
  BlockchainLatencyMeasurement,
  BlockchainLatencyMeasurements
} from "./latency-types";

const STORAGE_PREFIX = "traceforge:blockchain-latency:v1:";
const UPDATED_EVENT = "traceforge:blockchain-latency-updated";

export function getBlockchainLatencyStorageKey(identity: BlockchainLatencyIdentity): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(identity.promptId)}:${encodeURIComponent(identity.runId)}:${identity.claimIndex}`;
}

export function readBlockchainLatencyMeasurements(
  identity: BlockchainLatencyIdentity
): BlockchainLatencyMeasurements {
  if (typeof window === "undefined") return {};

  try {
    const serialized = window.localStorage.getItem(getBlockchainLatencyStorageKey(identity));
    if (!serialized) return {};

    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed)) return {};

    const sepolia = parseMeasurement(parsed.sepolia, "sepolia");
    const sui = parseMeasurement(parsed.sui, "sui");
    return { ...(sepolia ? { sepolia } : {}), ...(sui ? { sui } : {}) };
  } catch {
    return {};
  }
}

export function recordBlockchainLatencyMeasurement(
  identity: BlockchainLatencyIdentity,
  chain: BlockchainLatencyChain,
  elapsedMs: number,
  transactionId: string
): boolean {
  if (typeof window === "undefined" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return false;
  }

  const key = getBlockchainLatencyStorageKey(identity);
  try {
    const measurements = readBlockchainLatencyMeasurements(identity);
    const measurement: BlockchainLatencyMeasurement = {
      chain,
      elapsedMs,
      transactionId,
      recordedAt: new Date().toISOString()
    };
    window.localStorage.setItem(key, JSON.stringify({ ...measurements, [chain]: measurement }));
    window.dispatchEvent(new CustomEvent(UPDATED_EVENT, { detail: key }));
    return true;
  } catch {
    return false;
  }
}

export function subscribeToBlockchainLatencyChanges(key: string, onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    if (event.key === key) onChange();
  };
  const handleUpdate = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === key) onChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(UPDATED_EVENT, handleUpdate);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(UPDATED_EVENT, handleUpdate);
  };
}

function parseMeasurement(
  value: unknown,
  expectedChain: BlockchainLatencyChain
): BlockchainLatencyMeasurement | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.chain !== expectedChain ||
    typeof value.elapsedMs !== "number" ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0 ||
    typeof value.transactionId !== "string" ||
    typeof value.recordedAt !== "string"
  ) {
    return undefined;
  }

  return {
    chain: expectedChain,
    elapsedMs: value.elapsedMs,
    transactionId: value.transactionId,
    recordedAt: value.recordedAt
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
