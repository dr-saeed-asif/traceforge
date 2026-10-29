import { describe, expect, it } from "vitest";
import { encodeFunctionData, type Abi } from "viem";
import abi from "@traceforge/claim-anchoring/abi";
import { AUTHORIZED_ANCHOR_ABI } from "@/features/claim-anchoring/blockchain-anchor-client";
import { buildSuiAnchorTransaction } from "@/features/sui-claim-anchoring/sui-anchor-client";
import { compareAnchorPayloads, decodeAnchorInput } from "./anchor-decoder";

export const exampleInput =
  "0xbd1150396e4c1fb08dc736fa5f86d9aa8cf46f0c20d2b33d3bf0c9a50f0000d4daf0055b0000000000000000000000000000000000000000000000000000000000000002e731f8a84d2f68671062a8eb65d13c5750cb693502d2a3a02988fb42b8e9c62a05ea9bb7ee65496d3bf7e06bd4575192e223ff0577a4c603e7b96b613b8f067b0000000000000000000000000000000000000000000000000000000000000001";

const expected = {
  sessionHash: "0x6e4c1fb08dc736fa5f86d9aa8cf46f0c20d2b33d3bf0c9a50f0000d4daf0055b",
  claimIndex: 2,
  manifestHash: "0xe731f8a84d2f68671062a8eb65d13c5750cb693502d2a3a02988fb42b8e9c62a",
  evidenceRoot: "0x05ea9bb7ee65496d3bf7e06bd4575192e223ff0577a4c603e7b96b613b8f067b",
  schemaVersion: 1 as const,
  verdict: "VERIFIED" as const
};

describe("anchor input decoding", () => {
  it("decodes the signed-authorization Sepolia and Sui calls used by current clients", () => {
    const input = encodeFunctionData({
      abi: AUTHORIZED_ANCHOR_ABI,
      functionName: "anchorVerifiedClaimWithAuthorization",
      args: [
        expected.sessionHash,
        2,
        expected.manifestHash,
        expected.evidenceRoot,
        1,
        7n,
        999n,
        `0x${"ab".repeat(65)}`
      ]
    });
    expect(decodeAnchorInput("sepolia", input)).toEqual(expected);
    const tx = buildSuiAnchorTransaction(
      expected,
      { packageId: "0x1", registryId: "0x2", adminCapId: "0x3" },
      {
        nonce: `0x${"01".repeat(32)}`,
        deadlineMs: 1000,
        signature: `0x${"ab".repeat(64)}`,
        signerPublicKey: `0x02${"01".repeat(32)}`
      }
    );
    expect(decodeAnchorInput("sui", JSON.stringify(tx.getData()))).toEqual(expected);
  });
  function explorerFixture() {
    const hashInput = (hex: string) => ({
      type: "pure",
      valueType: "vector<u8>",
      value: Array.from({ length: 32 }, (_, index) =>
        parseInt(hex.slice(2 + index * 2, 4 + index * 2), 16)
      )
    });
    return {
      kind: "ProgrammableTransaction",
      inputs: [
        { type: "object" },
        { type: "object" },
        { type: "object" },
        hashInput(expected.sessionHash),
        { type: "pure", valueType: "u32", value: 2 },
        hashInput(expected.manifestHash),
        hashInput(expected.evidenceRoot),
        { type: "pure", valueType: "u32", value: 1 }
      ],
      transactions: [
        {
          MoveCall: {
            module: "verified_claim_registry",
            function: "anchor_verified_claim",
            arguments: Array.from({ length: 8 }, (_, Input) => ({ Input }))
          }
        }
      ]
    };
  }
  it("accepts complete explorer exports and JSON-RPC envelopes", () => {
    const result = { transaction: { data: { transaction: explorerFixture() } } };
    for (const wrapper of [
      { rawTransaction: { jsonrpc: "2.0", result }, status: "SUCCESS" },
      { jsonrpc: "2.0", result },
      result,
      explorerFixture()
    ]) {
      expect(decodeAnchorInput("sui", JSON.stringify(wrapper))).toEqual(expected);
    }
  });
  it("uses the Move argument references instead of assuming the input order", () => {
    const transaction = explorerFixture();
    transaction.inputs.unshift({ type: "object" });
    transaction.transactions[0]!.MoveCall.arguments.forEach((argument) => (argument.Input += 1));
    expect(decodeAnchorInput("sui", JSON.stringify(transaction))).toEqual(expected);
  });
  it("rejects malformed explorer byte arrays and unrelated Move calls", () => {
    const transaction = explorerFixture();
    (transaction.inputs[3]!.value as number[])[0] = 256;
    expect(() => decodeAnchorInput("sui", JSON.stringify(transaction))).toThrow(/integer bytes/);
    transaction.transactions[0]!.MoveCall.function = "transfer";
    expect(() => decodeAnchorInput("sui", JSON.stringify(transaction))).toThrow(/exactly one/);
  });
  it("decodes the supplied Sepolia transaction into the exact five commitment fields", () => {
    expect(decodeAnchorInput("sepolia", exampleInput)).toEqual(expected);
  });
  it("decodes the same logical payload from a Sui Move transaction", () => {
    const transaction = buildSuiAnchorTransaction(expected, {
      packageId: "0x1",
      registryId: "0x2",
      adminCapId: "0x3"
    });
    expect(decodeAnchorInput("sui", JSON.stringify(transaction.getData()))).toEqual(expected);
  });
  it("rejects truncated, unrelated, and trailing calldata", () => {
    expect(() => decodeAnchorInput("sepolia", exampleInput.slice(0, -2))).toThrow();
    expect(() => decodeAnchorInput("sepolia", exampleInput + "00")).toThrow();
    expect(() =>
      decodeAnchorInput("sepolia", exampleInput.replace("bd115039", "ffffffff"))
    ).toThrow();
    expect(() => decodeAnchorInput("sui", "not a transaction digest or BCS input")).toThrow();
  });
  it("reports exactly which fingerprint differs", () => {
    const checks = compareAnchorPayloads({ ...expected, claimIndex: 3 }, expected);
    expect(checks.filter((check) => !check.matches).map((check) => check.field)).toEqual([
      "claimIndex"
    ]);
  });
  it("decodes a future schema version without pretending it matches the current format", () => {
    const input = encodeFunctionData({
      abi: abi as Abi,
      functionName: "anchorVerifiedClaim",
      args: [
        expected.sessionHash,
        expected.claimIndex,
        expected.manifestHash,
        expected.evidenceRoot,
        2
      ]
    });
    const decoded = decodeAnchorInput("sepolia", input);
    expect(decoded.schemaVersion).toBe(2);
    expect(
      compareAnchorPayloads(decoded, expected).find((check) => check.field === "schemaVersion")
        ?.matches
    ).toBe(false);
  });
});
