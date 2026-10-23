import {
  createBlockchainClaimAnchorManifest,
  createBlockchainClaimAnchorPayload
} from "@traceforge/claim-anchoring";
import {
  type VerificationClaim,
  type VerificationSession,
  type VerificationTraceEvent
} from "@traceforge/verification-contracts";
import { decodeFunctionResult, encodeFunctionData, type Abi } from "viem";
import verifiedClaimRegistryAbi from "@traceforge/claim-anchoring/abi";

export const SEPOLIA_CHAIN_ID = "0xaa36a7";
export const VERIFIED_CLAIM_REGISTRY_ADDRESS = "0x9f616593277FF560Af07B2cae6AdEfB49844B8E9";
export const VERIFIED_CLAIM_REGISTRY_DEPLOYMENT_TX =
  "0xd3ed6cee4b16fdf09cfbcd69d86ec8a880cc6d57be8aac675235cddea300ba74";
// MetaMask's EIP-7702 smart-account wrapper consumed enough gas that its
// default estimate left too little for the registry call. Keep headroom for
// the wrapper as well as the contract execution.
const ANCHOR_GAS_LIMIT = "0x16e360"; // 1,500,000 gas
const VERIFIED_CLAIM_REGISTRY_ABI = verifiedClaimRegistryAbi as Abi;
const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";

interface EthereumProvider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

export type AnchorResult = {
  readonly confirmationTimeMs: number | null;
  readonly status: "confirmed" | "pending" | "already-anchored";
  readonly txHash: string | null;
  readonly blockNumber: string | null;
};

export type AnchorVerificationResult = {
  readonly recordFound: boolean;
  readonly matches: boolean;
  readonly recordId: string;
  readonly anchoredBy: string | null;
  readonly anchoredAt: string | null;
  readonly mismatches: readonly string[];
};

export async function anchorVerifiedClaim(
  session: VerificationSession,
  claim: VerificationClaim,
  traceEvents: readonly VerificationTraceEvent[]
): Promise<AnchorResult> {
  const provider = getProvider();
  const account = await getActiveAccount(provider);
  await switchToSepolia(provider);
  await assertContractOwner(provider, account);

  const manifest = createBlockchainClaimAnchorManifest(session, claim, traceEvents);
  const payload = await createBlockchainClaimAnchorPayload(manifest);
  const recordId = await readRecordId(provider, payload.sessionHash, payload.claimIndex);
  const key = localStorageKey(payload.sessionHash, payload.claimIndex);

  if (await isAlreadyAnchored(provider, recordId)) {
    const txHash = readSavedTransaction(key);
    return {
      status: "already-anchored",
      confirmationTimeMs: null,
      txHash,
      blockNumber: txHash ? await readTransactionBlockNumber(provider, txHash) : null
    };
  }

  const txHash = await sendAnchorTransaction(provider, account, payload);
  // eth_sendTransaction resolves with a hash after wallet approval/broadcast.
  const submittedAt = performance.now();
  saveTransaction(key, txHash);
  const receipt = await waitForReceipt(provider, txHash);
  return {
    status: receipt ? "confirmed" : "pending",
    confirmationTimeMs: receipt ? Math.round(performance.now() - submittedAt) : null,
    txHash,
    blockNumber: receipt?.blockNumber ?? null
  };
}

/** Recomputes the off-chain commitments and compares them with the Sepolia record. */
export async function verifyVerifiedClaimAnchor(
  session: VerificationSession,
  claim: VerificationClaim,
  traceEvents: readonly VerificationTraceEvent[]
): Promise<AnchorVerificationResult> {
  const provider = getProvider();
  await switchToSepolia(provider);

  const manifest = createBlockchainClaimAnchorManifest(session, claim, traceEvents);
  const payload = await createBlockchainClaimAnchorPayload(manifest);
  const recordId = await readRecordId(provider, payload.sessionHash, payload.claimIndex);
  const data = encodeFunctionData({
    abi: VERIFIED_CLAIM_REGISTRY_ABI,
    functionName: "getAnchor",
    args: [recordId as `0x${string}`]
  });
  const encodedRecord = await ethCall(provider, data);
  const decodedRecord = decodeFunctionResult({
    abi: VERIFIED_CLAIM_REGISTRY_ABI,
    functionName: "getAnchor",
    data: encodedRecord
  });
  const record = decodedRecord as {
    sessionHash: string;
    claimIndex: number;
    manifestHash: string;
    evidenceRoot: string;
    schemaVersion: number;
    anchoredAt: bigint;
    anchoredBy: string;
    verified: boolean;
  };
  if (!record || typeof record !== "object" || !("anchoredAt" in record)) {
    throw new Error("The Sepolia contract returned an invalid anchor record.");
  }

  const anchoredAt = record.anchoredAt;
  const anchoredBy = record.anchoredBy;
  const recordFound = anchoredAt > 0n && record.verified;
  const mismatches: string[] = [];

  if (!recordFound) {
    return {
      recordFound: false,
      matches: false,
      recordId,
      anchoredBy,
      anchoredAt: null,
      mismatches: ["No verified on-chain record exists for this claim."]
    };
  }

  if (record.sessionHash.toLowerCase() !== payload.sessionHash.toLowerCase()) {
    mismatches.push("Session hash");
  }
  if (record.claimIndex !== payload.claimIndex) mismatches.push("Claim ID");
  if (record.manifestHash.toLowerCase() !== payload.manifestHash.toLowerCase()) {
    mismatches.push("Evidence bundle / claim manifest hash");
  }
  if (record.evidenceRoot.toLowerCase() !== payload.evidenceRoot.toLowerCase()) {
    mismatches.push("Evidence root");
  }
  if (record.schemaVersion !== payload.schemaVersion) mismatches.push("Schema version");

  return {
    recordFound: true,
    matches: mismatches.length === 0,
    recordId,
    anchoredBy,
    anchoredAt: anchoredAt.toString(),
    mismatches
  };
}

export function getSepoliaTransactionUrl(txHash: string): string {
  return `${SEPOLIA_EXPLORER}/tx/${txHash}`;
}

export function getSepoliaContractUrl(): string {
  return `${SEPOLIA_EXPLORER}/address/${VERIFIED_CLAIM_REGISTRY_ADDRESS}`;
}

export function getSepoliaDeploymentUrl(): string {
  return getSepoliaTransactionUrl(VERIFIED_CLAIM_REGISTRY_DEPLOYMENT_TX);
}

async function getActiveAccount(provider: EthereumProvider): Promise<string> {
  let accounts = await requestAccounts(provider, "eth_accounts");
  if (accounts.length === 0) accounts = await requestAccounts(provider, "eth_requestAccounts");
  const account = accounts[0];
  if (!account || !/^0x[0-9a-f]{40}$/i.test(account)) {
    throw new Error("Connect your MetaMask account to TraceForge first.");
  }
  return account;
}

async function requestAccounts(provider: EthereumProvider, method: string): Promise<string[]> {
  const result = await provider.request({ method });
  if (!Array.isArray(result)) throw new Error("MetaMask returned an invalid account list.");
  return result.filter((entry): entry is string => typeof entry === "string");
}

async function switchToSepolia(provider: EthereumProvider): Promise<void> {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string") throw new Error("MetaMask did not report the selected network.");
  if (chainId.toLowerCase() === SEPOLIA_CHAIN_ID) return;

  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: SEPOLIA_CHAIN_ID }]
  });
  const switchedChainId = await provider.request({ method: "eth_chainId" });
  if (typeof switchedChainId !== "string" || switchedChainId.toLowerCase() !== SEPOLIA_CHAIN_ID) {
    throw new Error("Switch MetaMask to Sepolia, then try again.");
  }
}

async function assertContractOwner(provider: EthereumProvider, account: string): Promise<void> {
  const ownerData = await ethCall(
    provider,
    encodeFunctionData({ abi: VERIFIED_CLAIM_REGISTRY_ABI, functionName: "owner" })
  );
  const owner = decodeFunctionResult({
    abi: VERIFIED_CLAIM_REGISTRY_ABI,
    functionName: "owner",
    data: ownerData
  }) as string;
  if (owner.toLowerCase() !== account.toLowerCase()) {
    throw new Error("This contract only accepts anchors from its deploying MetaMask account.");
  }
}

async function readRecordId(
  provider: EthereumProvider,
  sessionHash: string,
  claimIndex: number
): Promise<string> {
  const data = encodeFunctionData({
    abi: VERIFIED_CLAIM_REGISTRY_ABI,
    functionName: "getRecordId",
    args: [sessionHash as `0x${string}`, claimIndex]
  });
  const result = await ethCall(provider, data);
  return decodeFunctionResult({
    abi: VERIFIED_CLAIM_REGISTRY_ABI,
    functionName: "getRecordId",
    data: result
  }) as string;
}

async function isAlreadyAnchored(provider: EthereumProvider, recordId: string): Promise<boolean> {
  const data = encodeFunctionData({
    abi: VERIFIED_CLAIM_REGISTRY_ABI,
    functionName: "getAnchor",
    args: [recordId as `0x${string}`]
  });
  const result = await ethCall(provider, data);
  const anchor = decodeFunctionResult({
    abi: VERIFIED_CLAIM_REGISTRY_ABI,
    functionName: "getAnchor",
    data: result
  });
  return (anchor as { verified: boolean }).verified;
}

async function sendAnchorTransaction(
  provider: EthereumProvider,
  account: string,
  payload: Awaited<ReturnType<typeof createBlockchainClaimAnchorPayload>>
): Promise<string> {
  const data = encodeFunctionData({
    abi: VERIFIED_CLAIM_REGISTRY_ABI,
    functionName: "anchorVerifiedClaim",
    args: [
      payload.sessionHash as `0x${string}`,
      payload.claimIndex,
      payload.manifestHash as `0x${string}`,
      payload.evidenceRoot as `0x${string}`,
      payload.schemaVersion
    ]
  });
  const result = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: account, to: VERIFIED_CLAIM_REGISTRY_ADDRESS, data, gas: ANCHOR_GAS_LIMIT }]
  });
  if (typeof result !== "string" || !/^0x[0-9a-f]{64}$/i.test(result)) {
    throw new Error("MetaMask did not return a transaction hash.");
  }
  return result;
}

async function ethCall(provider: EthereumProvider, data: `0x${string}`): Promise<`0x${string}`> {
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: VERIFIED_CLAIM_REGISTRY_ADDRESS, data }, "latest"]
  });
  if (typeof result !== "string" || !/^0x[0-9a-f]*$/i.test(result)) {
    throw new Error("The Sepolia contract returned an invalid response.");
  }
  return result as `0x${string}`;
}

async function waitForReceipt(
  provider: EthereumProvider,
  txHash: string
): Promise<{ blockNumber: string | null } | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash]
    });
    if (result && typeof result === "object" && "status" in result) {
      const receipt = result as { status?: unknown; blockNumber?: unknown };
      if (receipt.status === "0x1") {
        return { blockNumber: parseBlockNumber(receipt.blockNumber) };
      }
      if (receipt.status === "0x0")
        throw new Error("The blockchain transaction failed. Open its explorer link for details.");
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return null;
}

async function readTransactionBlockNumber(
  provider: EthereumProvider,
  txHash: string
): Promise<string | null> {
  const result = await provider.request({
    method: "eth_getTransactionReceipt",
    params: [txHash]
  });
  if (!result || typeof result !== "object" || !("status" in result)) return null;
  const receipt = result as { status?: unknown; blockNumber?: unknown };
  return receipt.status === "0x1" ? parseBlockNumber(receipt.blockNumber) : null;
}

function parseBlockNumber(value: unknown): string | null {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  return BigInt(value).toString(10);
}

function getProvider(): EthereumProvider {
  const provider = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  if (!provider)
    throw new Error(
      "MetaMask was not found. Open TraceForge in a browser with MetaMask installed."
    );
  return provider;
}

function localStorageKey(sessionHash: string, claimIndex: number): string {
  return `traceforge:sepolia-anchor:${sessionHash}:${claimIndex}`;
}

function saveTransaction(key: string, txHash: string): void {
  try {
    localStorage.setItem(key, txHash);
  } catch {
    // The anchor remains on-chain even when browser storage is unavailable.
  }
}

function readSavedTransaction(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
