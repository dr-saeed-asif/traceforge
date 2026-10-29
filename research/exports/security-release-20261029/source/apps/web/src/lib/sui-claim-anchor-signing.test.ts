import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getSuiSignerPublicKey, signSuiClaimAnchorAuthorization } from "./sui-claim-anchor-signing";

afterEach(() => vi.unstubAllEnvs());
it("compresses the known secp256k1 generator public key", () => {
  vi.stubEnv("TRACEFORGE_SUI_ANCHOR_SIGNER_PRIVATE_KEY", `0x${"0".repeat(63)}1`);
  expect(getSuiSignerPublicKey()).toBe(
    "0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
  );
});
it("creates correctly sized Sui authorization bytes without exposing the private key", async () => {
  vi.stubEnv("TRACEFORGE_SUI_ANCHOR_SIGNER_PRIVATE_KEY", `0x${"0".repeat(63)}1`);
  const result = await signSuiClaimAnchorAuthorization({
    sessionHash: `0x${"11".repeat(32)}`,
    claimIndex: 1,
    manifestHash: `0x${"22".repeat(32)}`,
    evidenceRoot: `0x${"33".repeat(32)}`,
    schemaVersion: 1,
    verdict: "VERIFIED"
  });
  expect(result.signature).toMatch(/^0x[0-9a-f]{128}$/);
  expect(result.nonce).toMatch(/^0x[0-9a-f]{64}$/);
  expect(result.signerPublicKey).toBe(getSuiSignerPublicKey());
});
