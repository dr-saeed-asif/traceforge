import { z } from "zod";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";

/**
 * Portable, artifact-bound claim records (review R4 Majors 1–2).
 *
 * A record is an in-toto Statement v1 whose subject is the digest of the
 * workspace state the agent finished with, and whose predicate lists every
 * extracted claim with its TraceForge verdict, reason and evidence hashes,
 * plus the prompt's hash-chain head. It is signed by the verifier in a DSSE
 * envelope (Ed25519). A downstream agent, CI gate or reviewer that receives
 * the code can check the signature, check that the record describes *that*
 * artifact, and decide whether to rely on the completion report — without
 * access to the originating environment.
 */
export const CLAIM_RECORD_PREDICATE_TYPE =
  "https://github.com/dr-saeed-asif/traceforge/claim-verification/v1";
export const IN_TOTO_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json";

type Verdict = "VERIFIED" | "CONTRADICTED" | "UNSUPPORTED" | "UNVERIFIABLE";

export interface ClaimRecordInput {
  readonly session: {
    readonly promptId: string;
    readonly runId: string;
    readonly agentName: string;
    readonly modelName: string;
  };
  readonly claims: readonly {
    readonly claimIndex: number;
    readonly claimType: string;
    readonly claimText: string;
    readonly target: string;
    readonly verdict: Verdict | null;
    readonly reasonCode: string | null;
    readonly explanation?: string | null;
    readonly evidenceEventIds: readonly string[];
    readonly verificationRuleVersion: string;
  }[];
  readonly traceEvents: readonly {
    readonly eventId: string;
    readonly sequenceNumber: number;
    readonly eventHash: string;
    readonly previousEventHash: string | null;
    readonly metadata: Readonly<Record<string, unknown>>;
  }[];
}

export interface ClaimRecordStatement {
  readonly _type: typeof IN_TOTO_STATEMENT_TYPE;
  readonly subject: readonly { readonly name: string; readonly digest: { readonly sha256: string } }[];
  readonly predicateType: typeof CLAIM_RECORD_PREDICATE_TYPE;
  readonly predicate: {
    readonly promptId: string;
    readonly runId: string;
    readonly agent: { readonly name: string; readonly model: string };
    readonly policyVersion: string;
    readonly traceHead: { readonly eventId: string; readonly eventHash: string; readonly eventCount: number };
    readonly verdictCounts: Readonly<Record<Verdict, number>>;
    readonly claims: readonly {
      readonly index: number;
      readonly type: string;
      readonly text: string;
      readonly target: string;
      readonly verdict: Verdict;
      readonly reasonCode: string;
      readonly advisory: boolean;
      readonly evidence: readonly { readonly eventId: string; readonly eventHash: string }[];
    }[];
  };
}

export interface DsseEnvelope {
  readonly payloadType: string;
  readonly payload: string;
  readonly signatures: readonly { readonly keyid: string; readonly sig: string }[];
}

export function buildClaimRecord(input: ClaimRecordInput): ClaimRecordStatement {
  const ordered = [...input.traceEvents].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  if (ordered.length && (ordered[0]!.sequenceNumber !== 1 || ordered[0]!.previousEventHash !== null ||
      new Set(ordered.map(e => e.eventId)).size !== ordered.length ||
      ordered.some((e, i) => e.sequenceNumber !== i + 1)))
    throw new Error("Trace hash chain is broken or incomplete");
  for (let i = 1; i < ordered.length; i += 1)
    if (ordered[i]!.previousEventHash !== ordered[i - 1]!.eventHash)
      throw new Error(`Trace hash chain is broken before ${ordered[i]!.eventId}`);
  const head = ordered[ordered.length - 1];
  if (!head) throw new Error("A claim record requires the prompt's trace");
  const digestEvent = [...ordered].reverse().find((e) => typeof e.metadata.workspaceDigest === "string");
  if (!digestEvent || digestEvent.metadata.workspaceObservation === "incomplete")
    throw new Error("No workspace digest was captured for this prompt; the record cannot be bound to an artifact");
  if (!/^[0-9a-f]{64}$/u.test(digestEvent.metadata.workspaceDigest as string))
    throw new Error("Invalid workspace digest");
  if (new Set(input.claims.map(c => c.verificationRuleVersion)).size > 1)
    throw new Error("A claim record requires one frozen policy version");
  const hashes = new Map(ordered.map((e) => [e.eventId, e.eventHash]));
  const claims = input.claims.map((claim) => {
    if (!claim.verdict || !claim.reasonCode) throw new Error(`Claim ${claim.claimIndex} has no verdict yet`);
    return {
      index: claim.claimIndex,
      type: claim.claimType,
      text: claim.claimText,
      target: claim.target,
      verdict: claim.verdict,
      reasonCode: claim.reasonCode,
      advisory: Boolean(claim.explanation?.includes("Advisory:")),
      evidence: claim.evidenceEventIds.map((eventId) => {
        const eventHash = hashes.get(eventId);
        if (!eventHash) throw new Error(`Evidence ${eventId} is missing from the trace`);
        return { eventId, eventHash };
      }),
    };
  });
  const counts: Record<Verdict, number> = { VERIFIED: 0, CONTRADICTED: 0, UNSUPPORTED: 0, UNVERIFIABLE: 0 };
  for (const claim of claims) counts[claim.verdict] += 1;
  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject: [{ name: "workspace", digest: { sha256: digestEvent.metadata.workspaceDigest as string } }],
    predicateType: CLAIM_RECORD_PREDICATE_TYPE,
    predicate: {
      promptId: input.session.promptId,
      runId: input.session.runId,
      agent: { name: input.session.agentName, model: input.session.modelName },
      policyVersion: input.claims[0]?.verificationRuleVersion ?? "unknown",
      traceHead: { eventId: head.eventId, eventHash: head.eventHash, eventCount: ordered.length },
      verdictCounts: counts,
      claims,
    },
  };
}

/** DSSE pre-authentication encoding (DSSE spec v1). */
function pae(payloadType: string, payload: Buffer): Buffer {
  const type = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} `, "utf8"),
    type,
    Buffer.from(` ${payload.length} `, "utf8"),
    payload,
  ]);
}

export function keyIdFor(publicKey: KeyObject): string {
  return createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
}

export function signClaimRecord(statement: ClaimRecordStatement, privateKeyPem: string): DsseEnvelope {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Claim records require an Ed25519 signing key");
  const payload = Buffer.from(JSON.stringify(statement), "utf8");
  const sig = signBytes(null, pae(DSSE_PAYLOAD_TYPE, payload), privateKey);
  return {
    payloadType: DSSE_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [{ keyid: keyIdFor(createPublicKey(privateKey)), sig: sig.toString("base64") }],
  };
}

const verdictSchema = z.enum(["VERIFIED", "CONTRADICTED", "UNSUPPORTED", "UNVERIFIABLE"]);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const statementSchema = z.object({
  _type: z.literal(IN_TOTO_STATEMENT_TYPE),
  subject: z.array(z.object({ name: z.literal("workspace"), digest: z.object({ sha256: digestSchema }) })).length(1),
  predicateType: z.literal(CLAIM_RECORD_PREDICATE_TYPE),
  predicate: z.object({
    promptId: z.string().min(1), runId: z.string().min(1),
    agent: z.object({ name: z.string(), model: z.string() }), policyVersion: z.string().min(1),
    traceHead: z.object({ eventId: z.string().min(1), eventHash: digestSchema, eventCount: z.number().int().positive() }),
    verdictCounts: z.object({ VERIFIED: z.number().int().nonnegative(), CONTRADICTED: z.number().int().nonnegative(), UNSUPPORTED: z.number().int().nonnegative(), UNVERIFIABLE: z.number().int().nonnegative() }),
    claims: z.array(z.object({ index: z.number().int().positive(), type: z.string().min(1), text: z.string(), target: z.string(),
      verdict: verdictSchema, reasonCode: z.string().min(1), advisory: z.boolean(),
      evidence: z.array(z.object({ eventId: z.string().min(1), eventHash: digestSchema })) })),
  }),
});

export function openClaimRecord(envelope: DsseEnvelope, publicKeyPem: string): ClaimRecordStatement | null {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519" || envelope.payloadType !== DSSE_PAYLOAD_TYPE) return null;
    const payload = Buffer.from(envelope.payload, "base64");
    const valid = envelope.signatures.some(s => s.keyid === keyIdFor(publicKey) &&
      verifyBytes(null, pae(envelope.payloadType, payload), publicKey, Buffer.from(s.sig, "base64")));
    if (!valid) return null;
    const parsed = statementSchema.safeParse(JSON.parse(payload.toString("utf8")));
    if (!parsed.success) return null;
    const statement = parsed.data;
    const claims = statement.predicate.claims;
    if (new Set(claims.map(c => c.index)).size !== claims.length) return null;
    for (const verdict of verdictSchema.options)
      if (statement.predicate.verdictCounts[verdict] !== claims.filter(c => c.verdict === verdict).length) return null;
    return statement;
  } catch { return null; }
}

export interface GatePolicy {
  /** Claim types whose Unsupported verdict blocks acceptance (default: all objective types). */
  readonly blockingUnsupportedTypes?: readonly string[];
  /** Require at least one verified test claim. */
  readonly requireVerifiedTest?: boolean;
}

export interface GateDecision {
  readonly decision: "ACCEPT" | "REJECT" | "REVIEW";
  readonly reasons: readonly string[];
}

/**
 * Consumer-side decision on a received claim record. REJECT on an invalid
 * signature, a record for a different artifact, any Contradicted claim, or a
 * blocking Unsupported claim; REVIEW when tests changed before a passing run
 * or only unverifiable claims remain; otherwise ACCEPT.
 */
export function decideOnClaimRecord(
  envelope: DsseEnvelope,
  publicKeyPem: string,
  receivedArtifactDigest: string,
  policy: GatePolicy = {},
): GateDecision {
  const statement = openClaimRecord(envelope, publicKeyPem);
  if (!statement) return { decision: "REJECT", reasons: ["Signature or envelope is invalid"] };
  if (statement.subject[0]?.digest.sha256 !== receivedArtifactDigest)
    return { decision: "REJECT", reasons: ["The record describes a different artifact than the one received"] };
  if (statement.predicate.claims.length === 0)
    return { decision: "REVIEW", reasons: ["The report made no auditable claims"] };
  const blocking = new Set(
    policy.blockingUnsupportedTypes ?? ["FILE_CREATED", "FILE_MODIFIED", "STRUCTURE_CREATED", "DEPENDENCY_RULE", "COMMAND_SUCCEEDED", "BUILD_PASSED", "TEST_PASSED", "TASK_COMPLETED"],
  );
  const reasons: string[] = [];
  for (const claim of statement.predicate.claims) {
    if (claim.verdict === "CONTRADICTED") reasons.push(`Claim ${claim.index} is contradicted by evidence: "${claim.text}"`);
    if (claim.verdict === "UNSUPPORTED" && blocking.has(claim.type))
      reasons.push(`Claim ${claim.index} is unsupported (${claim.reasonCode}): "${claim.text}"`);
  }
  if (policy.requireVerifiedTest && !statement.predicate.claims.some((c) => c.type === "TEST_PASSED" && c.verdict === "VERIFIED"))
    reasons.push("No verified test claim");
  if (reasons.length > 0) return { decision: "REJECT", reasons };
  const review: string[] = [];
  if (statement.predicate.claims.some((c) => c.advisory)) review.push("Existing tests were modified before a passing run");
  if (statement.predicate.claims.length > 0 && statement.predicate.claims.every((c) => c.verdict === "UNVERIFIABLE"))
    review.push("Only unverifiable claims were made");
  return review.length > 0 ? { decision: "REVIEW", reasons: review } : { decision: "ACCEPT", reasons: ["All objective claims verified"] };
}
