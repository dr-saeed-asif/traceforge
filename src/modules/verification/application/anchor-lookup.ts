import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  VerificationRepository,
  VerificationSessionDetails,
} from "./ports/verification-repository.js";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}
const hash = (value: unknown) =>
  `0x${createHash("sha256").update(canonical(value)).digest("hex")}`;

/** Same schema-v1 commitments used by the browser; parity is covered by tests. */
export function anchorLookupHashes(details: VerificationSessionDetails) {
  const sessionHash = hash([
    "traceforge-session-v1",
    details.session.promptId,
    details.session.runId,
  ]);
  const events = new Map(
    details.traceEvents.map((event) => [event.eventId, event.eventHash]),
  );
  const claims = details.claims.flatMap((claim) => {
    if (
      claim.verdict !== "VERIFIED" ||
      claim.verifiedAt === null ||
      claim.evidenceEventIds.some((id) => !events.has(id))
    )
      return [];
    const manifest = {
      schemaVersion: 1,
      sessionId: details.session.promptId,
      runId: details.session.runId,
      claimIndex: claim.claimIndex,
      verdict: "VERIFIED",
      claimType: claim.claimType,
      claimText: claim.claimText,
      target: claim.target,
      expectedResult: claim.expectedResult,
      evidence: claim.evidenceEventIds.map((eventId) => ({
        eventId,
        eventHash: events.get(eventId)!,
      })),
      verificationRuleVersion: claim.verificationRuleVersion,
      verifiedAt: claim.verifiedAt,
    };
    return [{ claimIndex: claim.claimIndex, manifestHash: hash(manifest) }];
  });
  return { sessionHash, claims };
}

export function normalizeAnchorLookup(input: {
  sessionHash?: string;
  manifestHash?: string;
  claimIndex?: string;
}) {
  if (!input.sessionHash && !input.manifestHash)
    throw new RangeError("Enter a sessionHash or manifestHash.");
  const normalize = (value: string | undefined) => {
    if (value === undefined) return undefined;
    if (!/^0x[0-9a-f]{64}$/i.test(value.trim()))
      throw new RangeError(
        "Hashes must be 0x followed by 64 hexadecimal characters.",
      );
    return value.trim().toLowerCase();
  };
  const claimIndex =
    input.claimIndex === undefined ? undefined : Number(input.claimIndex);
  if (
    input.claimIndex !== undefined &&
    (!/^\d+$/.test(input.claimIndex) ||
      !Number.isSafeInteger(claimIndex) ||
      claimIndex! < 1)
  )
    throw new RangeError("claimIndex must be a positive integer.");
  return {
    sessionHash: normalize(input.sessionHash),
    manifestHash: normalize(input.manifestHash),
    claimIndex,
  };
}

/** Incremental SQLite index. Existing data is indexed on first lookup. */
export class AnchorLookup {
  constructor(
    private readonly database: DatabaseSync,
    private readonly repository: VerificationRepository,
  ) {}

  async search(input: {
    sessionHash?: string;
    manifestHash?: string;
    claimIndex?: string;
  }) {
    const query = normalizeAnchorLookup(input);
    const dirty = this.database
      .prepare(
        `SELECT s.id, s.prompt_id FROM anchor_lookup_dirty d JOIN execution_sessions s ON s.id = d.session_id`,
      )
      .all() as unknown as { id: number; prompt_id: string }[];
    for (const row of dirty) {
      const details = await this.repository.getSessionDetails(row.prompt_id);
      if (!details) continue;
      const hashes = anchorLookupHashes(details);
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database
          .prepare(
            "INSERT INTO anchor_session_lookup VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET session_hash = excluded.session_hash",
          )
          .run(row.id, hashes.sessionHash);
        this.database
          .prepare("DELETE FROM anchor_claim_lookup WHERE session_id = ?")
          .run(row.id);
        for (const claim of hashes.claims)
          this.database
            .prepare("INSERT INTO anchor_claim_lookup VALUES (?, ?, ?)")
            .run(row.id, claim.claimIndex, claim.manifestHash);
        this.database
          .prepare("DELETE FROM anchor_lookup_dirty WHERE session_id = ?")
          .run(row.id);
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];
    if (query.sessionHash) {
      conditions.push("a.session_hash = ?");
      parameters.push(query.sessionHash);
    }
    if (query.manifestHash) {
      conditions.push("c.manifest_hash = ?");
      parameters.push(query.manifestHash);
    }
    const rows = this.database
      .prepare(
        `SELECT s.prompt_id, a.session_hash FROM anchor_session_lookup a JOIN execution_sessions s ON s.id = a.session_id ${query.manifestHash ? "JOIN anchor_claim_lookup c ON c.session_id = s.id" : ""}
      WHERE ${conditions.join(" AND ")} ORDER BY s.id DESC LIMIT 2`,
      )
      .all(...parameters) as unknown as {
      prompt_id: string;
      session_hash: string;
    }[];
    const matches = [];
    for (const row of rows) {
      const details = await this.repository.getSessionDetails(row.prompt_id);
      if (!details) continue;
      const indices = query.manifestHash
        ? anchorLookupHashes(details)
            .claims.filter((claim) => claim.manifestHash === query.manifestHash)
            .map((claim) => claim.claimIndex)
        : null;
      const claims = details.claims.filter(
        (claim) =>
          (query.claimIndex === undefined ||
            claim.claimIndex === query.claimIndex) &&
          (indices === null || indices.includes(claim.claimIndex)),
      );
      if (query.claimIndex !== undefined && claims.length === 0) continue;
      matches.push({
        session: details.session,
        sessionHash: row.session_hash,
        claims,
      });
    }
    return { matches };
  }
}
