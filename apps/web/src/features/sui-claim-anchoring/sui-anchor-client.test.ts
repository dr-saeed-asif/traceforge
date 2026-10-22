import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockchainClaimAnchorPayload } from "@traceforge/claim-anchoring";
import {
  buildSuiAnchorTransaction,
  getSuiAnchorDeployment,
  getSuiTestnetTransactionUrl
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
