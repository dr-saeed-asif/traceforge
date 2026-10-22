"use client";

import type {
  VerificationClaim,
  VerificationSession,
  VerificationTraceEvent,
  VerificationVerdict
} from "@traceforge/verification-contracts";
import Link from "next/link";
import { Badge, Card, CardHeader, DataTable, VerdictBadge } from "@/components/ui";
import { BlockchainAnchorButton } from "../claim-anchoring/blockchain-anchor-button";
import { SuiClaimAnchorButton } from "../sui-claim-anchoring/sui-claim-anchor-button";
import { BlockchainLatencyComparison } from "../blockchain-latency/latency-comparison";
import { eventDomId, humanize } from "./format";
import styles from "./session-details.module.css";

export function ClaimsTable({
  claims,
  traceEvents,
  session
}: Readonly<{
  claims: readonly VerificationClaim[];
  traceEvents: readonly VerificationTraceEvent[];
  session: VerificationSession;
}>) {
  const sequenceByEventId = new Map(
    traceEvents.map((event) => [event.eventId, event.sequenceNumber] as const)
  );

  return (
    <Card id="claims">
      <CardHeader
        title="Extracted claims"
        description="Deterministic verdicts with reason codes and their exact supporting events."
      />
      <div className={styles.claimsTable}>
        <DataTable
          caption="Extracted verification claims"
          rows={claims}
          getRowKey={(claim) => claim.claimIndex}
          getRowId={(claim) => `claim-${claim.claimIndex}`}
          emptyContent="No objective claims were extracted from the final response."
          columns={[
            {
              key: "claim",
              header: "Claim",
              width: "30%",
              cell: (claim) => (
                <div className={styles.claimText}>
                  <span>Claim {claim.claimIndex}</span>
                  <strong>{claim.claimText}</strong>
                  <small>{claim.expectedResult}</small>
                </div>
              )
            },
            {
              key: "type",
              header: "Type / Target",
              cell: (claim) => (
                <div className={styles.claimType}>
                  <Badge tone="info">{humanize(claim.claimType)}</Badge>
                  <code title={claim.target}>{claim.target}</code>
                </div>
              )
            },
            {
              key: "verdict",
              header: "Verdict / Reason",
              cell: (claim) => (
                <div className={styles.claimVerdict}>
                  <VerdictBadge verdict={claim.verdict} />
                  {claim.reasonCode ? (
                    <Badge tone={reasonTone(claim.verdict)}>{humanize(claim.reasonCode)}</Badge>
                  ) : null}
                </div>
              )
            },
            {
              key: "explanation",
              header: "Explanation",
              width: "23%",
              cell: (claim) => claim.explanation ?? "Verification is pending."
            },
            {
              key: "evidence",
              header: "Evidence",
              cell: (claim) =>
                claim.evidenceEventIds.length === 0 ? (
                  <span className={styles.noEvidence}>No evidence linked</span>
                ) : (
                  <div className={styles.evidenceLinks}>
                    {claim.evidenceEventIds.map((eventId) => (
                      <Link key={eventId} href={`#${eventDomId(eventId)}`}>
                        Event #{sequenceByEventId.get(eventId) ?? "?"}
                      </Link>
                    ))}
                  </div>
                )
            },
            {
              key: "blockchain",
              header: "Blockchain",
              cell: (claim) =>
                claim.verdict === "VERIFIED" ? (
                  <div className={styles.blockchainAnchorActions}>
                    <BlockchainAnchorButton
                      session={session}
                      claim={claim}
                      traceEvents={traceEvents}
                    />
                    <SuiClaimAnchorButton
                      session={session}
                      claim={claim}
                      traceEvents={traceEvents}
                    />
                  </div>
                ) : (
                  <span className={styles.noEvidence}>Verified claims only</span>
                )
            }
          ]}
        />
      </div>
      {claims.some((claim) => claim.verdict === "VERIFIED") ? (
        <section className={styles.latencySection} aria-labelledby="blockchain-latency-title">
          <div className={styles.latencySectionHeader}>
            <h3 id="blockchain-latency-title">Blockchain latency comparison</h3>
            <p>
              Compare successful anchor times for each verified claim. Times include wallet approval
              and transaction confirmation. Measurements are saved in this browser.
            </p>
          </div>
          <div className={styles.latencyGrid}>
            {claims
              .filter((claim) => claim.verdict === "VERIFIED")
              .map((claim) => (
                <BlockchainLatencyComparison
                  key={claim.claimIndex}
                  identity={{
                    promptId: session.promptId,
                    runId: session.runId,
                    claimIndex: claim.claimIndex
                  }}
                />
              ))}
          </div>
        </section>
      ) : null}
    </Card>
  );
}

function reasonTone(verdict: VerificationVerdict | null) {
  if (verdict === "VERIFIED") return "success" as const;
  if (verdict === "CONTRADICTED") return "danger" as const;
  if (verdict === "UNSUPPORTED") return "warning" as const;
  return "neutral" as const;
}
