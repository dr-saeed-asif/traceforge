import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { applySqliteMigrations } from "../../../src/infrastructure/sqlite/sqlite-migrator.js";
import { SqliteVerificationRepository } from "../../../src/modules/verification/infrastructure/sqlite/sqlite-verification-repository.js";
import {
  AnchorLookup,
  anchorLookupHashes,
} from "../../../src/modules/verification/application/anchor-lookup.js";
import {
  createBlockchainClaimAnchorManifest,
  createBlockchainClaimAnchorPayload,
} from "../../../packages/claim-anchoring/src/index.js";
import { parseAnchorLookupResponse } from "../../../packages/verification-contracts/src/index.js";

it("backfills hash lookup, matches browser commitments, and refreshes changed claims", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  try {
    await applySqliteMigrations(db);
    const repo = new SqliteVerificationRepository(db);
    await repo.createSession({
      promptId: "p",
      externalSessionId: "s",
      runId: "r",
      promptResultId: null,
      projectName: "test",
      projectPath: "/test",
      agentName: "OpenCode",
      modelName: "agent",
      policyVersion: "1",
      startedAt: "2026-10-23T10:00:00Z",
    });
    await repo.saveExtractedClaim({
      promptId: "p",
      claimIndex: 1,
      claimText: "Created a.js",
      claimType: "FILE_CREATED",
      target: "a.js",
      expectedResult: "exists",
      extractorModel: "extractor",
      extractionPromptVersion: "1",
      verificationRuleVersion: "1",
    });
    await repo.saveClaimVerification({
      promptId: "p",
      claimIndex: 1,
      verdict: "VERIFIED",
      reasonCode: "REQUIRED_EVIDENCE_CONFIRMED",
      explanation: "fixture",
      evidence: [],
      ruleVersion: "1",
      verifiedAt: "2026-10-23T10:01:00Z",
    });
    const details = (await repo.getSessionDetails("p"))!;
    const browser = await createBlockchainClaimAnchorPayload(
      createBlockchainClaimAnchorManifest(
        details.session,
        details.claims[0]!,
        details.traceEvents,
      ),
    );
    const backend = anchorLookupHashes(details);
    expect(backend.sessionHash).toBe(browser.sessionHash);
    expect(backend.claims[0]?.manifestHash).toBe(browser.manifestHash);
    const service = new AnchorLookup(db, repo);
    const bySession = await service.search({
      sessionHash: browser.sessionHash.toUpperCase(),
    });
    expect(
      parseAnchorLookupResponse(bySession).matches[0]?.claims[0]?.claimText,
    ).toBe("Created a.js");
    expect(
      (await service.search({ manifestHash: browser.manifestHash })).matches[0]
        ?.session.promptId,
    ).toBe("p");
    expect(
      (
        await service.search({
          sessionHash: browser.sessionHash,
          claimIndex: "2",
        })
      ).matches,
    ).toHaveLength(0);
    expect(db.prepare("SELECT * FROM anchor_lookup_dirty").all()).toHaveLength(
      0,
    );
    db.prepare(
      "UPDATE agent_claims SET claim_text = ? WHERE claim_index = 1",
    ).run("Created b.js");
    expect(db.prepare("SELECT * FROM anchor_lookup_dirty").all()).toHaveLength(
      1,
    );
    expect(
      (await service.search({ manifestHash: browser.manifestHash })).matches,
    ).toHaveLength(0);
    expect(
      (await service.search({ sessionHash: browser.sessionHash })).matches[0]
        ?.claims[0]?.claimText,
    ).toBe("Created b.js");
    await expect(service.search({ sessionHash: "invalid" })).rejects.toThrow(
      /Hashes/,
    );
    await expect(service.search({})).rejects.toThrow(/Enter/);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  } finally {
    db.close();
  }
});
