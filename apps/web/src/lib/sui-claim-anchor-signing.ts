import "server-only";
import { privateKeyToAccount } from "viem/accounts";
import { bytesToHex, hexToBytes, keccak256, parseSignature } from "viem";
import { bcs } from "@mysten/sui/bcs";
import type { BlockchainClaimAnchorPayload } from "@traceforge/claim-anchoring";

const AuthorizationMessage = bcs.struct("AuthorizationMessage", {
  session_hash: bcs.vector(bcs.u8()),
  claim_index: bcs.u32(),
  manifest_hash: bcs.vector(bcs.u8()),
  evidence_root: bcs.vector(bcs.u8()),
  schema_version: bcs.u32(),
  nonce: bcs.vector(bcs.u8()),
  deadline_ms: bcs.u64()
});

export async function signSuiClaimAnchorAuthorization(payload: BlockchainClaimAnchorPayload) {
  const key = getSuiSignerKey();
  if (!key || !/^0x[0-9a-f]{64}$/i.test(key))
    throw new Error("Sui claim anchor signing is not configured on the server.");
  const account = privateKeyToAccount(key as `0x${string}`);
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const deadlineMs = Date.now() + 10 * 60 * 1000;
  const message = AuthorizationMessage.serialize({
    session_hash: Array.from(hexToBytes(payload.sessionHash as `0x${string}`)),
    claim_index: payload.claimIndex,
    manifest_hash: Array.from(hexToBytes(payload.manifestHash as `0x${string}`)),
    evidence_root: Array.from(hexToBytes(payload.evidenceRoot as `0x${string}`)),
    schema_version: payload.schemaVersion,
    nonce: Array.from(nonce),
    deadline_ms: BigInt(deadlineMs)
  }).toBytes();
  const signed = await account.sign({ hash: keccak256(bytesToHex(message)) });
  const parsed = parseSignature(signed);
  const signature = `0x${parsed.r.slice(2)}${parsed.s.slice(2)}` as `0x${string}`;
  const publicKey = hexToBytes(account.publicKey);
  const compressed = new Uint8Array(33);
  const lastByte = publicKey[64];
  if (publicKey.length !== 65 || lastByte === undefined)
    throw new Error("Invalid uncompressed signer public key.");
  compressed[0] = lastByte % 2 === 0 ? 2 : 3;
  compressed.set(publicKey.slice(1, 33), 1);
  return {
    nonce: bytesToHex(nonce),
    deadlineMs,
    signature,
    signerPublicKey: bytesToHex(compressed),
    signer: account.address
  };
}

export function getSuiSignerPublicKey(): string {
  const account = privateKeyToAccount(getSuiSignerKey() as `0x${string}`);
  const publicKey = hexToBytes(account.publicKey);
  const compressed = new Uint8Array(33);
  const lastByte = publicKey[64];
  if (publicKey.length !== 65 || lastByte === undefined)
    throw new Error("Invalid uncompressed signer public key.");
  compressed[0] = lastByte % 2 === 0 ? 2 : 3;
  compressed.set(publicKey.slice(1, 33), 1);
  return bytesToHex(compressed);
}

function getSuiSignerKey(): string {
  const key =
    process.env.TRACEFORGE_SUI_ANCHOR_SIGNER_PRIVATE_KEY ??
    process.env.TRACEFORGE_ANCHOR_SIGNER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-f]{64}$/i.test(key))
    throw new Error("Sui claim anchor signing is not configured on the server.");
  return key;
}
