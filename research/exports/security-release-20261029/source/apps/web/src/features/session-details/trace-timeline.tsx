import type {
  JsonObject,
  VerificationClaim,
  VerificationTraceEvent
} from "@traceforge/verification-contracts";
import Link from "next/link";
import { Badge, Card, CardHeader } from "@/components/ui";
import { compactHash, eventDomId, formatDateTime, humanize } from "./format";
import styles from "./session-details.module.css";

export function TraceTimeline({
  traceEvents,
  claims
}: Readonly<{
  traceEvents: readonly VerificationTraceEvent[];
  claims: readonly VerificationClaim[];
}>) {
  const claimsByEventId = indexClaimsByEvent(claims);

  return (
    <Card id="trace-events">
      <CardHeader
        title="Trace-event timeline"
        description="Immutable evidence in persisted sequence order. Claim-linked events are highlighted."
      />
      {traceEvents.length === 0 ? (
        <p className={styles.timelineEmpty}>No trace events were captured for this session.</p>
      ) : (
        <ol className={styles.timeline}>
          {traceEvents.map((event) => {
            const claimIndexes = claimsByEventId.get(event.eventId) ?? [];
            return (
              <li key={event.eventId}>
                <article
                  id={eventDomId(event.eventId)}
                  className={`${styles.eventCard} ${claimIndexes.length > 0 ? styles.linkedEvent : ""}`}
                >
                  <header className={styles.eventHeader}>
                    <div className={styles.eventIdentity}>
                      <span className={styles.sequence}>#{event.sequenceNumber}</span>
                      <div>
                        <h3>{humanize(event.eventType)}</h3>
                        <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
                      </div>
                    </div>
                    <Badge tone={outcomeTone(event.outcome)}>{humanize(event.outcome)}</Badge>
                  </header>

                  {claimIndexes.length > 0 ? (
                    <div className={styles.relatedClaims}>
                      <span>Evidence for</span>
                      {claimIndexes.map((claimIndex) => (
                        <Link key={claimIndex} href={`#claim-${claimIndex}`}>
                          Claim {claimIndex}
                        </Link>
                      ))}
                    </div>
                  ) : null}

                  <EventEvidence event={event} />
                  <HashChain event={event} />
                  {Object.keys(event.metadata).length > 0 ? (
                    <details className={styles.metadataDisclosure}>
                      <summary>Captured metadata</summary>
                      <pre>{formatMetadata(event.metadata)}</pre>
                    </details>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function EventEvidence({ event }: Readonly<{ event: VerificationTraceEvent }>) {
  const isFileEvent = Boolean(
    event.filePath ||
    event.fileExistedBefore !== null ||
    event.fileExistsAfter !== null ||
    event.fileHashBefore ||
    event.fileHashAfter
  );
  const isCommandEvent = Boolean(
    event.command || event.workingDirectory || event.exitCode !== null
  );
  const hasTestCounts =
    event.testPassed !== null || event.testFailed !== null || event.testSkipped !== null;

  if (!isFileEvent && !isCommandEvent && !hasTestCounts && !event.target && !event.toolName) {
    return null;
  }

  return (
    <div className={styles.evidenceGrid}>
      {event.toolName ? <Evidence label="Tool" value={event.toolName} /> : null}
      {event.target ? <Evidence label="Target" value={event.target} mono /> : null}
      {event.filePath ? <Evidence label="File" value={event.filePath} mono /> : null}
      {isFileEvent ? (
        <Evidence
          label="File state"
          value={`${fileState(event.fileExistedBefore)} → ${fileState(event.fileExistsAfter)}`}
        />
      ) : null}
      {event.command ? <Evidence label="Command" value={event.command} mono wide /> : null}
      {event.workingDirectory ? (
        <Evidence label="Working directory" value={event.workingDirectory} mono />
      ) : null}
      {event.exitCode !== null ? (
        <Evidence label="Exit code" value={String(event.exitCode)} />
      ) : null}
      {hasTestCounts ? (
        <Evidence
          label="Test result"
          value={`${event.testPassed ?? 0} passed · ${event.testFailed ?? 0} failed · ${event.testSkipped ?? 0} skipped`}
          wide
        />
      ) : null}
    </div>
  );
}

function HashChain({ event }: Readonly<{ event: VerificationTraceEvent }>) {
  return (
    <details className={styles.hashDisclosure}>
      <summary>
        Hash chain <code>{compactHash(event.eventHash)}</code>
      </summary>
      <dl className={styles.hashGrid}>
        <Hash label="Previous event" value={event.previousEventHash} />
        <Hash label="Event" value={event.eventHash} />
        {event.outputHash ? <Hash label="Output" value={event.outputHash} /> : null}
        {event.fileHashBefore ? <Hash label="File before" value={event.fileHashBefore} /> : null}
        {event.fileHashAfter ? <Hash label="File after" value={event.fileHashAfter} /> : null}
      </dl>
    </details>
  );
}

function Evidence({
  label,
  value,
  mono = false,
  wide = false
}: Readonly<{ label: string; value: string; mono?: boolean; wide?: boolean }>) {
  return (
    <div className={wide ? styles.evidenceWide : undefined}>
      <span>{label}</span>
      <strong className={mono ? styles.mono : undefined}>{value}</strong>
    </div>
  );
}

function Hash({ label, value }: Readonly<{ label: string; value: string | null }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code title={value ?? "Genesis event"}>{value ?? "Genesis"}</code>
      </dd>
    </div>
  );
}

function indexClaimsByEvent(claims: readonly VerificationClaim[]): Map<string, readonly number[]> {
  const mutable = new Map<string, number[]>();
  for (const claim of claims) {
    for (const eventId of claim.evidenceEventIds) {
      const indexes = mutable.get(eventId) ?? [];
      indexes.push(claim.claimIndex);
      mutable.set(eventId, indexes);
    }
  }
  return mutable;
}

function fileState(value: boolean | null): string {
  if (value === null) return "unknown";
  return value ? "exists" : "missing";
}

function outcomeTone(outcome: VerificationTraceEvent["outcome"]) {
  if (outcome === "SUCCEEDED") return "success" as const;
  if (outcome === "FAILED") return "danger" as const;
  return "neutral" as const;
}

function formatMetadata(metadata: JsonObject): string {
  return JSON.stringify(metadata, null, 2);
}
