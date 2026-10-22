import {
  createBlockchainClaimAnchorManifest,
  createBlockchainClaimAnchorPayload,
  type BlockchainClaimAnchorPayload
} from "@traceforge/claim-anchoring";
import { SUI_CLAIM_ANCHOR_MODULE, SUI_TESTNET_NETWORK } from "@traceforge/sui-claim-anchoring";
import { isValidSuiObjectId, normalizeSuiObjectId } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import type {
  VerificationClaim,
  VerificationSession,
  VerificationTraceEvent
} from "@traceforge/verification-contracts";

export interface SuiAnchorDeployment {
  readonly packageId: string;
  readonly registryId: string;
  readonly adminCapId: string;
}

export interface SuiAnchorResult {
  readonly digest: string;
  readonly explorerUrl: string;
  /** Includes wallet approval time and Sui execution time. */
  readonly elapsedMs: number;
}

export function getSuiAnchorDeployment(): SuiAnchorDeployment {
  const packageId = process.env.NEXT_PUBLIC_SUI_ANCHOR_PACKAGE_ID?.trim();
  const registryId = process.env.NEXT_PUBLIC_SUI_ANCHOR_REGISTRY_ID?.trim();
  const adminCapId = process.env.NEXT_PUBLIC_SUI_ANCHOR_ADMIN_CAP_ID?.trim();

  if (!packageId || !registryId || !adminCapId) {
    throw new Error(
      "Sui testnet anchoring is not configured yet. Deploy the Move package, then set its package, registry, and admin-cap object IDs in the web environment."
    );
  }

  return {
    packageId: normalizeObjectId(packageId, "package"),
    registryId: normalizeObjectId(registryId, "registry"),
    adminCapId: normalizeObjectId(adminCapId, "admin capability")
  };
}

export async function createSuiAnchorTransaction(
  session: VerificationSession,
  claim: VerificationClaim,
  traceEvents: readonly VerificationTraceEvent[],
  deployment: SuiAnchorDeployment
): Promise<Transaction> {
  const manifest = createBlockchainClaimAnchorManifest(session, claim, traceEvents);
  const payload = await createBlockchainClaimAnchorPayload(manifest);
  return buildSuiAnchorTransaction(payload, deployment);
}

export function buildSuiAnchorTransaction(
  payload: BlockchainClaimAnchorPayload,
  deployment: SuiAnchorDeployment
): Transaction {
  const transaction = new Transaction();
  transaction.moveCall({
    target: `${deployment.packageId}::${SUI_CLAIM_ANCHOR_MODULE}::anchor_verified_claim`,
    arguments: [
      transaction.object(deployment.registryId),
      transaction.object(deployment.adminCapId),
      transaction.object("0x6"),
      transaction.pure.vector("u8", hexToBytes32(payload.sessionHash)),
      transaction.pure.u32(payload.claimIndex),
      transaction.pure.vector("u8", hexToBytes32(payload.manifestHash)),
      transaction.pure.vector("u8", hexToBytes32(payload.evidenceRoot)),
      transaction.pure.u32(payload.schemaVersion)
    ]
  });
  return transaction;
}

export function getSuiTestnetTransactionUrl(digest: string): string {
  return `https://suiexplorer.com/txblock/${encodeURIComponent(digest)}?network=testnet`;
}

function normalizeObjectId(value: string, label: string): string {
  if (!isValidSuiObjectId(value)) {
    throw new Error(`The configured Sui ${label} ID is invalid.`);
  }
  return normalizeSuiObjectId(value);
}

function hexToBytes32(value: string): number[] {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new TypeError("Sui anchor hashes must be exactly 32 bytes.");
  }
  return Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16)
  );
}

export const SUI_ANCHOR_TESTNET = SUI_TESTNET_NETWORK;
