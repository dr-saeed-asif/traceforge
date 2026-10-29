import { decodeFunctionData, encodeFunctionData, type Abi } from "viem";
import { AUTHORIZED_ANCHOR_ABI } from "@/features/claim-anchoring/blockchain-anchor-client";
import abi from "@traceforge/claim-anchoring/abi";
import type { BlockchainClaimAnchorPayload } from "@traceforge/claim-anchoring";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { fromBase64, fromHex, toHex } from "@mysten/sui/utils";

export type DecodedAnchorPayload = Omit<BlockchainClaimAnchorPayload, "schemaVersion"> & {
  schemaVersion: number;
};

export type AnchorChain = "sepolia" | "sui";
export const payloadFields = [
  "sessionHash",
  "claimIndex",
  "manifestHash",
  "evidenceRoot",
  "schemaVersion"
] as const;

export function decodeAnchorInput(chain: AnchorChain, input: string): DecodedAnchorPayload {
  const text = input.trim();
  if (!text || text.length > 200000)
    throw new Error("Paste a transaction input of up to 200,000 characters.");
  if (chain === "sepolia") {
    if (!/^0x(?:[0-9a-fA-F]{2}){164,}$/.test(text))
      throw new Error(
        "Expected 164 bytes for a legacy anchor call, or complete signed-authorization calldata."
      );
    const decoded = decodeFunctionData({
      abi: [...abi, ...AUTHORIZED_ANCHOR_ABI] as Abi,
      data: text as `0x${string}`
    });
    if (!(
      (decoded.functionName === "anchorVerifiedClaim" && decoded.args?.length === 5) ||
      (decoded.functionName === "anchorVerifiedClaimWithAuthorization" &&
        decoded.args?.length === 8)
    ))
      throw new Error("This is not a TraceForge anchorVerifiedClaim call.");
    const [sessionHash, claimIndex, manifestHash, evidenceRoot, schemaVersion] = decoded.args;
    const result = {
      sessionHash: String(sessionHash),
      claimIndex: Number(claimIndex),
      manifestHash: String(manifestHash),
      evidenceRoot: String(evidenceRoot),
      schemaVersion: Number(schemaVersion),
      verdict: "VERIFIED" as const
    };
    // Reject trailing bytes and noncanonical integer padding rather than silently ignoring them.
    if (
      encodeFunctionData({
        abi: [...abi, ...AUTHORIZED_ANCHOR_ABI] as Abi,
        functionName: decoded.functionName,
        args: decoded.args
      }).toLowerCase() !== text.toLowerCase()
    )
      throw new Error("The calldata is not a canonical TraceForge anchor call.");
    return result;
  }
  if (text.startsWith("{")) {
    const explorer = decodeSuiExplorerJson(JSON.parse(text));
    if (explorer) return explorer;
  }
  const transaction = Transaction.from(
    text.startsWith("{") ? text : text.startsWith("0x") ? fromHex(text) : fromBase64(text)
  );
  const data = transaction.getData();
  const calls = data.commands.filter(
    (command) =>
      command.MoveCall?.module === "verified_claim_registry" &&
      ["anchor_verified_claim", "anchor_verified_claim_with_authorization"].includes(
        command.MoveCall.function
      )
  );
  if (calls.length !== 1)
    throw new Error(
      "Expected exactly one verified_claim_registry::anchor_verified_claim Move call."
    );
  const args = calls[0]!.MoveCall!.arguments;
  const authorized = calls[0]!.MoveCall!.function === "anchor_verified_claim_with_authorization";
  if (args.length !== (authorized ? 10 : 8)) throw new Error("Invalid Sui anchor argument count.");
  const offset = authorized ? -1 : 0;
  const pure = (position: number) => {
    const arg = args[position];
    if (arg?.$kind !== "Input")
      throw new Error("Anchor arguments must reference direct transaction inputs.");
    const value = data.inputs[arg.Input]?.Pure?.bytes;
    if (!value) throw new Error("Missing BCS pure argument.");
    return fromBase64(value);
  };
  const hash = (position: number) => {
    const bytes = bcs.vector(bcs.u8()).parse(pure(position));
    if (bytes.length !== 32) throw new Error("Anchor hashes must be exactly 32 bytes.");
    return `0x${toHex(new Uint8Array(bytes))}`;
  };
  return {
    sessionHash: hash(3 + offset),
    claimIndex: bcs.u32().parse(pure(4 + offset)),
    manifestHash: hash(5 + offset),
    evidenceRoot: hash(6 + offset),
    schemaVersion: bcs.u32().parse(pure(7 + offset)),
    verdict: "VERIFIED"
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Decode explorer/JSON-RPC data by following the Move call's Input references. */
function decodeSuiExplorerJson(value: unknown): DecodedAnchorPayload | null {
  const root = record(value);
  if (!root) return null;
  const response = record(root.rawTransaction) ?? root;
  const result = record(response.result) ?? response;
  const data =
    record(record(record(result.transaction)?.data)?.transaction) ??
    (result.kind === "ProgrammableTransaction" ? result : null);
  if (!data) return null;
  if (
    data.kind !== "ProgrammableTransaction" ||
    !Array.isArray(data.inputs) ||
    !Array.isArray(data.transactions)
  )
    throw new Error("Expected Sui ProgrammableTransaction inputs and Move calls.");
  const calls = data.transactions
    .map((command) => record(record(command)?.MoveCall))
    .filter(
      (call) =>
        call?.module === "verified_claim_registry" &&
        ["anchor_verified_claim", "anchor_verified_claim_with_authorization"].includes(
          String(call.function)
        )
    );
  if (calls.length !== 1)
    throw new Error(
      "Expected exactly one verified_claim_registry::anchor_verified_claim Move call."
    );
  const args = calls[0]!.arguments;
  const authorized = calls[0]!.function === "anchor_verified_claim_with_authorization";
  if (!Array.isArray(args) || args.length !== (authorized ? 10 : 8))
    throw new Error("Invalid Sui anchor argument count.");
  const offset = authorized ? -1 : 0;
  const inputs: unknown[] = data.inputs;
  const pure = (position: number, type: string) => {
    const index = record(args[position])?.Input;
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0)
      throw new Error("Anchor arguments must reference direct transaction inputs.");
    const input = record(inputs[index]);
    if (input?.type !== "pure" || input.valueType !== type)
      throw new Error(`Expected a pure ${type} input at argument ${position}.`);
    return input.value;
  };
  const hash = (position: number) => {
    const bytes = pure(position, "vector<u8>");
    if (
      !Array.isArray(bytes) ||
      bytes.length !== 32 ||
      bytes.some(
        (byte) => typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255
      )
    )
      throw new Error("Anchor hashes must contain exactly 32 integer bytes (0–255).");
    return `0x${toHex(Uint8Array.from(bytes))}`;
  };
  const u32 = (position: number) => {
    const value = pure(position, "u32");
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw new Error("Expected an unsigned 32-bit integer.");
    return value;
  };
  return {
    sessionHash: hash(3 + offset),
    claimIndex: u32(4 + offset),
    manifestHash: hash(5 + offset),
    evidenceRoot: hash(6 + offset),
    schemaVersion: u32(7 + offset),
    verdict: "VERIFIED"
  };
}

export function compareAnchorPayloads(
  actual: DecodedAnchorPayload,
  expected: BlockchainClaimAnchorPayload
) {
  return payloadFields.map((field) => ({
    field,
    actual: actual[field],
    expected: expected[field],
    matches: String(actual[field]).toLowerCase() === String(expected[field]).toLowerCase()
  }));
}
