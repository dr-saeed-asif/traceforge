import "server-only";
import { privateKeyToAccount } from "viem/accounts";
import type { BlockchainClaimAnchorPayload } from "@traceforge/claim-anchoring";

export const SEPOLIA_CHAIN_ID = 11_155_111;
const types = {
  ClaimAnchor: [
    { name: "sessionHash", type: "bytes32" },
    { name: "claimIndex", type: "uint32" },
    { name: "manifestHash", type: "bytes32" },
    { name: "evidenceRoot", type: "bytes32" },
    { name: "schemaVersion", type: "uint32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" }
  ]
} as const;

export async function signClaimAnchorAuthorization(payload: BlockchainClaimAnchorPayload) {
  const privateKey = process.env.TRACEFORGE_ANCHOR_SIGNER_PRIVATE_KEY;
  const contractAddress = process.env.TRACEFORGE_SEPOLIA_REGISTRY_ADDRESS;
  if (!privateKey || !/^0x[0-9a-f]{64}$/i.test(privateKey))
    throw new Error("Claim anchor signing is not configured on the server.");
  if (!contractAddress || !/^0x[0-9a-f]{40}$/i.test(contractAddress))
    throw new Error("The Sepolia claim registry address is not configured on the server.");
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce =
    `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const signature = await account.signTypedData({
    domain: {
      name: "TraceForge Verified Claim Registry",
      version: "1",
      chainId: SEPOLIA_CHAIN_ID,
      verifyingContract: contractAddress as `0x${string}`
    },
    types,
    primaryType: "ClaimAnchor",
    message: {
      sessionHash: payload.sessionHash as `0x${string}`,
      claimIndex: payload.claimIndex,
      manifestHash: payload.manifestHash as `0x${string}`,
      evidenceRoot: payload.evidenceRoot as `0x${string}`,
      schemaVersion: payload.schemaVersion,
      nonce: BigInt(nonce),
      deadline: BigInt(deadline)
    }
  });
  return { payload, nonce, deadline, signature, signer: account.address };
}
