"use client";

import type {
  VerificationClaim,
  VerificationSession,
  VerificationSessionDetailsResponse,
  VerificationTraceEvent
} from "@traceforge/verification-contracts";
import { ButtonLink } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  ExecutionStatusBadge,
  ProcessingStatusBadge,
  VerdictBadge
} from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Icon } from "@/components/icons";
import { humanize } from "@/features/session-details/format";
import { BlockchainAnchorButton } from "@/features/claim-anchoring/blockchain-anchor-button";
import { SuiClaimAnchorButton } from "@/features/sui-claim-anchoring/sui-claim-anchor-button";
import { formatDateTime, formatPercent, type DailySummary } from "./daily-summary";
import styles from "./sessions.module.css";

interface DailySummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  day: DailySummary | null;
}

interface QueryDetails {
  readonly session: VerificationSession;
  readonly claims: readonly VerificationClaim[];
  readonly traceEvents: readonly VerificationTraceEvent[];
}

export function DailySummaryModal({ isOpen, onClose, day }: DailySummaryModalProps) {
  const [queries, setQueries] = useState<QueryDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);

  const fetchDayDetails = useCallback(async () => {
    if (!day) return;
    setLoading(true);
    setError(null);
    try {
      const responses = await Promise.all(
        day.sessions.map(async (session): Promise<QueryDetails> => {
          const response = await fetch(`/api/sessions/${encodeURIComponent(session.promptId)}`);
          if (!response.ok) throw new Error("Failed to fetch session details");
          const data = (await response.json()) as VerificationSessionDetailsResponse;
          return {
            session: data.session,
            claims: data.claims,
            traceEvents: data.traceEvents
          };
        })
      );
      setQueries(responses);
    } catch {
      setError("Failed to load queries for this day. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => {
    if (!isOpen || !day) return;
    const timer = window.setTimeout(() => void fetchDayDetails(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, day, fetchDayDetails]);

  if (!isOpen || !day) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setExpandedPromptId(null);
        onClose();
      }}
      title={`Queries - ${day.dateDisplay}`}
      size="xl"
    >
      {loading ? (
        <LoadingState label="Loading queries..." />
      ) : error ? (
        <ErrorState description={error} action={<Button onClick={fetchDayDetails}>Retry</Button>} />
      ) : queries.length === 0 ? (
        <EmptyState
          title="No queries found"
          description="No captured prompts were found for this day."
        />
      ) : (
        <DataTable
          caption={`Queries for ${day.dateDisplay}`}
          rows={queries}
          getRowKey={(query) => query.session.promptId}
          columns={[
            {
              key: "time",
              header: "Time",
              width: "14%",
              cell: ({ session }) => (
                <time className={styles.tableDate} dateTime={session.startedAt}>
                  {formatDateTime(session.startedAt)}
                </time>
              )
            },
            {
              key: "query",
              header: "Query",
              width: "30%",
              cell: ({ session }) => (
                <div className={styles.claimText}>
                  <strong>{session.promptQuery ?? "Prompt text unavailable"}</strong>
                  <small>{session.projectName ?? session.promptId}</small>
                </div>
              )
            },
            {
              key: "agent",
              header: "Agent",
              width: "12%",
              cell: ({ session }) => session.agentName
            },
            {
              key: "model",
              header: "Model",
              width: "14%",
              cell: ({ session }) => session.modelName
            },
            {
              key: "claims",
              header: "Claims",
              align: "end",
              width: "8%",
              cell: ({ session }) => session.totalClaims
            },
            {
              key: "reliability",
              header: "Reliability",
              align: "end",
              width: "10%",
              cell: ({ session }) => (
                <strong className={styles.tableMetric}>
                  {formatPercent(session.reliabilityPercent)}
                </strong>
              )
            },
            {
              key: "expand",
              header: "",
              width: "5%",
              align: "center",
              cell: ({ session }) => (
                <button
                  className={styles.expandButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedPromptId((current) =>
                      current === session.promptId ? null : session.promptId
                    );
                  }}
                  aria-label={expandedPromptId === session.promptId ? "Collapse" : "Expand"}
                  aria-expanded={expandedPromptId === session.promptId}
                >
                  <Icon
                    name="arrow"
                    className={`${styles.expandIcon} ${expandedPromptId === session.promptId ? styles.expanded : ""}`}
                  />
                </button>
              )
            }
          ]}
          renderExpandedRow={(query) =>
            expandedPromptId === query.session.promptId ? <ExpandedQueryView query={query} /> : null
          }
        />
      )}
    </Modal>
  );
}

function ExpandedQueryView({ query }: { query: QueryDetails }) {
  const { session, claims, traceEvents } = query;
  const sequenceByEventId = new Map(
    traceEvents.map((event) => [event.eventId, event.sequenceNumber] as const)
  );

  return (
    <div className={styles.expandedRow}>
      <div className={styles.expandedContent}>
        <div className={styles.expandedSection}>
          <h4>Processing status</h4>
          <dl className={styles.expandedDetails}>
            <div>
              <dt>Execution</dt>
              <dd>
                <ExecutionStatusBadge status={session.executionStatus} />
              </dd>
            </div>
            <div>
              <dt>Extraction</dt>
              <dd>
                <ProcessingStatusBadge status={session.extractionStatus} />
              </dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>
                <ProcessingStatusBadge status={session.verificationStatus} />
              </dd>
            </div>
          </dl>
          <ButtonLink
            className={styles.openSessionLink}
            href={`/sessions/${encodeURIComponent(session.promptId)}`}
            size="sm"
            variant="secondary"
          >
            Open session details
          </ButtonLink>
        </div>

        <div className={styles.expandedSection}>
          <h4>Claims ({claims.length})</h4>
          {claims.length === 0 ? (
            <p className={styles.noClaimsMessage}>No claims were extracted from this query.</p>
          ) : (
            <div className={styles.claimList}>
              {claims.map((claim) => {
                const evidenceEvents = traceEvents.filter((event) =>
                  claim.evidenceEventIds.includes(event.eventId)
                );
                return (
                  <div className={styles.claimBlock} key={claim.claimIndex}>
                    <dl className={styles.expandedDetails}>
                      <div>
                        <dt>Claim</dt>
                        <dd>{claim.claimText}</dd>
                      </div>
                      <div>
                        <dt>Type</dt>
                        <dd>
                          <Badge tone="info">{humanize(claim.claimType)}</Badge>
                        </dd>
                      </div>
                      <div>
                        <dt>Target</dt>
                        <dd>
                          <code>{claim.target}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Expected Result</dt>
                        <dd>{claim.expectedResult}</dd>
                      </div>
                      <div>
                        <dt>Verdict</dt>
                        <dd>
                          <div className={styles.verdictAnchorActions}>
                            <VerdictBadge verdict={claim.verdict} />
                            {claim.verdict === "VERIFIED" ? (
                              <>
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
                              </>
                            ) : null}
                          </div>
                        </dd>
                      </div>
                      {claim.reasonCode && (
                        <div>
                          <dt>Reason</dt>
                          <dd>
                            <Badge tone="neutral">{humanize(claim.reasonCode)}</Badge>
                          </dd>
                        </div>
                      )}
                      {claim.explanation && (
                        <div>
                          <dt>Explanation</dt>
                          <dd>{claim.explanation}</dd>
                        </div>
                      )}
                    </dl>
                    {evidenceEvents.length > 0 && (
                      <div className={styles.evidenceList}>
                        {evidenceEvents.map((event) => (
                          <EvidenceEventCard
                            key={event.id}
                            event={event}
                            sequenceByEventId={sequenceByEventId}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EvidenceEventCard({
  event,
  sequenceByEventId
}: {
  event: VerificationTraceEvent;
  sequenceByEventId: Map<string, number>;
}) {
  return (
    <Card className={styles.evidenceCard}>
      <CardHeader
        title={humanize(event.eventType)}
        description={`Sequence #${sequenceByEventId.get(event.eventId) ?? "?"} · ${new Date(event.occurredAt).toLocaleString()}`}
      />
      <CardBody>
        <dl className={styles.evidenceDetails}>
          {event.target && (
            <div>
              <dt>Target</dt>
              <dd>
                <code>{event.target}</code>
              </dd>
            </div>
          )}
          {event.toolName && (
            <div>
              <dt>Tool</dt>
              <dd>{event.toolName}</dd>
            </div>
          )}
          {event.filePath && (
            <div>
              <dt>File</dt>
              <dd>
                <code>{event.filePath}</code>
              </dd>
            </div>
          )}
          {event.command && (
            <div>
              <dt>Command</dt>
              <dd>
                <code>{event.command}</code>
              </dd>
            </div>
          )}
          {event.exitCode !== null && (
            <div>
              <dt>Exit Code</dt>
              <dd>{event.exitCode}</dd>
            </div>
          )}
          {event.testPassed !== null && (
            <div>
              <dt>Tests Passed</dt>
              <dd>{event.testPassed}</dd>
            </div>
          )}
          {event.testFailed !== null && (
            <div>
              <dt>Tests Failed</dt>
              <dd>{event.testFailed}</dd>
            </div>
          )}
          {event.fileExistedBefore !== null && (
            <div>
              <dt>Existed Before</dt>
              <dd>{event.fileExistedBefore ? "Yes" : "No"}</dd>
            </div>
          )}
          {event.fileExistsAfter !== null && (
            <div>
              <dt>Exists After</dt>
              <dd>{event.fileExistsAfter ? "Yes" : "No"}</dd>
            </div>
          )}
          {event.fileHashBefore && (
            <div>
              <dt>Hash Before</dt>
              <dd>
                <code>{event.fileHashBefore}</code>
              </dd>
            </div>
          )}
          {event.fileHashAfter && (
            <div>
              <dt>Hash After</dt>
              <dd>
                <code>{event.fileHashAfter}</code>
              </dd>
            </div>
          )}
          {event.outputHash && (
            <div>
              <dt>Output Hash</dt>
              <dd>
                <code>{event.outputHash}</code>
              </dd>
            </div>
          )}
          {Object.keys(event.metadata).length > 0 && (
            <div>
              <dt>Metadata</dt>
              <dd>
                <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
              </dd>
            </div>
          )}
        </dl>
      </CardBody>
    </Card>
  );
}
