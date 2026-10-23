import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockchainClaimAnchorPayload } from "@traceforge/claim-anchoring";
import { ObjectError } from "@mysten/sui/client";
import {
  buildSuiAnchorTransaction,
  getSuiAnchorDeployment,
  getSuiTestnetTransactionUrl,
  findSuiClaimAnchor,
  SuiAnchorRecord,
  SuiAnchorKey,
  type SuiAnchorReader
} from "./sui-anchor-client";

const deployment = {
  packageId: `0x${"1".repeat(64)}`,
  registryId: `0x${"2".repeat(64)}`,
  adminCapId: `0x${"3".repeat(64)}`
};

const payload: BlockchainClaimAnchorPayload = {
  schemaVersion: 1,
  sessionHash: `0x${"11".repeat(32)}`,
  claimIndex: 4,
  manifestHash: `0x${"22".repeat(32)}`,
  evidenceRoot: `0x${"33".repeat(32)}`,
  verdict: "VERIFIED"
};

describe("Sui claim anchoring client", () => {
  afterEach(() => vi.unstubAllEnvs());

  function reader(manifestByte = 34) {
    return {
      getDynamicField: vi.fn(async () => ({
        dynamicField: {
          fieldId: deployment.registryId,
          previousTransaction: "existing-digest",
          value: {
            bcs: SuiAnchorRecord.serialize({
              session_hash: Array(32).fill(17),
              claim_index: 4,
              manifest_hash: Array(32).fill(manifestByte),
              evidence_root: Array(32).fill(51),
              schema_version: 1,
              anchored_at_ms: "1000",
              anchored_by: deployment.adminCapId,
              verified: true
            }).toBytes()
          }
        }
      }))
    };
  }

  it("finds a matching commitment using the exact Move dynamic-field key", async () => {
    const client = reader();
    const result = await findSuiClaimAnchor(
      client as unknown as SuiAnchorReader,
      payload,
      deployment
    );
    expect(result).toMatchObject({ matches: true, digest: "existing-digest" });
    const request = client.getDynamicField.mock.calls[0] as unknown as [
      { parentId: string; name: { type: string; bcs: Uint8Array } }
    ];
    expect(request[0].parentId).toBe(deployment.registryId);
    expect(request[0].name.type).toBe(
      `${deployment.packageId}::verified_claim_registry::AnchorKey`
    );
    expect(SuiAnchorKey.parse(request[0].name.bcs)).toEqual({
      session_hash: Array(32).fill(17),
      claim_index: 4
    });
  });

  it("reports an existing record with different evidence as a mismatch", async () => {
    expect(
      await findSuiClaimAnchor(reader(99) as unknown as SuiAnchorReader, payload, deployment)
    ).toMatchObject({ matches: false });
  });

  it("only treats a confirmed missing object as an absent anchor", async () => {
    const client = {
      getDynamicField: vi
        .fn()
        .mockRejectedValue(new ObjectError("notFound", "missing", { reason: "notFound" }))
    };
    expect(await findSuiClaimAnchor(client, payload, deployment)).toBeNull();
    client.getDynamicField.mockRejectedValue(new Error("RPC unavailable"));
    await expect(findSuiClaimAnchor(client, payload, deployment)).rejects.toThrow(
      "RPC unavailable"
    );
  });

  it("builds a Move call for the verified-claim registry", () => {
    const transaction = buildSuiAnchorTransaction(payload, deployment);
    const data = transaction.getData() as {
      commands: Array<{
        MoveCall?: {
          package: string;
          module: string;
          function: string;
          arguments: unknown[];
        };
      }>;
    };

    expect(data.commands).toHaveLength(1);
    expect(data.commands[0]?.MoveCall).toMatchObject({
      package: deployment.packageId,
      module: "verified_claim_registry",
      function: "anchor_verified_claim"
    });
    expect(data.commands[0]?.MoveCall?.arguments).toHaveLength(8);
  });

  it("requires all public deployment object IDs before submitting", () => {
    vi.stubEnv("NEXT_PUBLIC_SUI_ANCHOR_PACKAGE_ID", "");
    vi.stubEnv("NEXT_PUBLIC_SUI_ANCHOR_REGISTRY_ID", "");
    vi.stubEnv("NEXT_PUBLIC_SUI_ANCHOR_ADMIN_CAP_ID", "");

    expect(() => getSuiAnchorDeployment()).toThrow(/not configured yet/i);
  });

  it("creates a Sui Explorer link for testnet transactions", () => {
    expect(getSuiTestnetTransactionUrl("digest-value")).toBe(
      "https://suiexplorer.com/txblock/digest-value?network=testnet"
    );
  });
});
