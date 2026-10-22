import type {
  ClaimType,
  VerificationClaim,
  VerificationSession,
  VerificationTraceEvent,
} from "@traceforge/verification-contracts";

/** Increment when the off-chain anchor manifest or on-chain payload changes. */
export const BLOCKCHAIN_ANCHOR_SCHEMA_VERSION = 1 as const;

/**
 * Private/off-chain audit details used to create and later verify an anchor.
 * Do not send this object directly to Ethereum: it can contain claim text and
 * evidence identifiers. Only its digest and the evidence root go on-chain.
 */
export interface BlockchainClaimAnchorManifest {
  readonly schemaVersion: typeof BLOCKCHAIN_ANCHOR_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly runId: string;
  readonly claimIndex: number;
  readonly verdict: "VERIFIED";
  readonly claimType: ClaimType;
  readonly claimText: string;
  readonly target: string;
  readonly expectedResult: string;
  readonly evidence: readonly BlockchainClaimAnchorEvidence[];
  readonly verificationRuleVersion: string;
  readonly verifiedAt: string;
}

export interface BlockchainClaimAnchorEvidence {
  readonly eventId: string;
  readonly eventHash: string;
}

/** Public fields intended for the Ethereum contract call/event. */
export interface BlockchainClaimAnchorPayload {
  readonly schemaVersion: typeof BLOCKCHAIN_ANCHOR_SCHEMA_VERSION;
  /** bytes32 digest of the TraceForge session/run identity. */
  readonly sessionHash: string;
  readonly claimIndex: number;
  /** bytes32 digest of the canonical off-chain manifest. */
  readonly manifestHash: string;
  /** bytes32 commitment to the evidence event hashes. */
  readonly evidenceRoot: string;
  readonly verdict: "VERIFIED";
}

/**
 * Creates the private audit manifest for one claim. Eligibility is checked
 * here so pending or non-verified claims cannot be prepared for anchoring.
 */
export function createBlockchainClaimAnchorManifest(
  session: VerificationSession,
  claim: VerificationClaim,
  traceEvents: readonly VerificationTraceEvent[],
): BlockchainClaimAnchorManifest {
  if (claim.verdict !== "VERIFIED") {
    throw new TypeError(
      "Only VERIFIED claims can be prepared for blockchain anchoring",
    );
  }
  if (claim.verifiedAt === null) {
    throw new TypeError("A verified claim must have a verification timestamp");
  }

  const eventsById = new Map(
    traceEvents.map((event) => [event.eventId, event] as const),
  );
  const evidence = claim.evidenceEventIds.map((eventId) => {
    const event = eventsById.get(eventId);
    if (!event)
      throw new TypeError(`Missing evidence event ${JSON.stringify(eventId)}`);
    return { eventId, eventHash: event.eventHash };
  });

  return {
    schemaVersion: BLOCKCHAIN_ANCHOR_SCHEMA_VERSION,
    sessionId: session.promptId,
    runId: session.runId,
    claimIndex: claim.claimIndex,
    verdict: "VERIFIED",
    claimType: claim.claimType,
    claimText: claim.claimText,
    target: claim.target,
    expectedResult: claim.expectedResult,
    evidence,
    verificationRuleVersion: claim.verificationRuleVersion,
    verifiedAt: claim.verifiedAt,
  };
}

/**
 * Hashes the manifest into the exact bytes32 fields consumed by the Solidity
 * contract. SHA-256 is used on both sides so browser Web Crypto and Solidity's
 * built-in sha256 produce identical commitments.
 */
export async function createBlockchainClaimAnchorPayload(
  manifest: BlockchainClaimAnchorManifest,
): Promise<BlockchainClaimAnchorPayload> {
  if (manifest.verdict !== "VERIFIED") {
    throw new TypeError(
      "Only VERIFIED claims can be prepared for blockchain anchoring",
    );
  }

  const sessionHash = await sha256Hex(
    canonicalJson([
      "traceforge-session-v1",
      manifest.sessionId,
      manifest.runId,
    ]),
  );
  const evidenceRoot = await sha256Hex(
    canonicalJson(
      manifest.evidence.map(({ eventId, eventHash }) => [eventId, eventHash]),
    ),
  );
  const manifestHash = await sha256Hex(canonicalJson(manifest));

  return {
    schemaVersion: manifest.schemaVersion,
    sessionHash,
    claimIndex: manifest.claimIndex,
    manifestHash,
    evidenceRoot,
    verdict: "VERIFIED",
  };
}

/** Recomputes the commitments and checks that a saved manifest still matches. */
export async function verifyBlockchainClaimAnchorPayload(
  manifest: BlockchainClaimAnchorManifest,
  payload: BlockchainClaimAnchorPayload,
): Promise<boolean> {
  const recomputed = await createBlockchainClaimAnchorPayload(manifest);
  return (
    recomputed.schemaVersion === payload.schemaVersion &&
    recomputed.sessionHash === normalizeBytes32(payload.sessionHash) &&
    recomputed.claimIndex === payload.claimIndex &&
    recomputed.manifestHash === normalizeBytes32(payload.manifestHash) &&
    recomputed.evidenceRoot === normalizeBytes32(payload.evidenceRoot) &&
    recomputed.verdict === payload.verdict
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function sha256Hex(value: string): Promise<string> {
  const cryptoApi = (
    globalThis as unknown as {
      crypto?: {
        subtle?: {
          digest: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>;
        };
      };
    }
  ).crypto;
  if (!cryptoApi?.subtle)
    throw new Error("SHA-256 requires Web Crypto support");

  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  const digest = await cryptoApi.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes),
  );
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeBytes32(value: string): string {
  return value.startsWith("0x")
    ? value.toLowerCase()
    : `0x${value.toLowerCase()}`;
}
