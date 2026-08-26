import { canonicalize, hashesEqual, sha256, type CanonicalJsonValue } from "@traceforge/crypto";
import type { ProvenanceEvent, UnhashedProvenanceEvent } from "@traceforge/domain";

export interface EventVerificationResult {
  readonly valid: boolean;
  readonly eventId: string;
  readonly expectedHash: string;
  readonly calculatedHash: string;
  readonly reason?: string;
}

export interface ChainVerificationResult {
  readonly status: "VERIFIED" | "TAMPERED" | "INCOMPLETE" | "UNVERIFIED";
  readonly checkedEvents: number;
  readonly failedSequence?: number;
  readonly failedEventId?: string;
  readonly expectedHash?: string | null;
  readonly calculatedHash?: string | null;
  readonly reason?: string;
}

function hashInput(event: UnhashedProvenanceEvent): string {
  return `${event.previousEventHash ?? ""}${canonicalize(event as unknown as CanonicalJsonValue)}`;
}

export function calculateEventHash(event: UnhashedProvenanceEvent): string {
  return sha256(hashInput(event));
}

export function sealEvent<T extends UnhashedProvenanceEvent>(event: T): T & { readonly eventHash: string } {
  return Object.freeze({ ...event, eventHash: calculateEventHash(event) });
}

export function verifyEvent(event: ProvenanceEvent): EventVerificationResult {
  const { eventHash, ...withoutHash } = event;
  const calculatedHash = calculateEventHash(withoutHash);
  return {
    valid: hashesEqual(eventHash, calculatedHash),
    eventId: event.eventId,
    expectedHash: eventHash,
    calculatedHash
  };
}

export function verifyEventChain(events: readonly ProvenanceEvent[]): ChainVerificationResult {
  if (events.length === 0) {
    return { status: "UNVERIFIED", checkedEvents: 0, reason: "No events were supplied" };
  }

  let previousHash: string | null = null;
  let previousSequence = 0;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) continue;

    if (event.sequence !== previousSequence + 1) {
      return {
        status: "INCOMPLETE",
        checkedEvents: index,
        failedSequence: event.sequence,
        failedEventId: event.eventId,
        reason: `Expected sequence ${previousSequence + 1}, received ${event.sequence}`
      };
    }
    if (event.previousEventHash !== previousHash) {
      return {
        status: "TAMPERED",
        checkedEvents: index,
        failedSequence: event.sequence,
        failedEventId: event.eventId,
        expectedHash: previousHash,
        calculatedHash: event.previousEventHash,
        reason: "Previous event hash does not match the verified predecessor"
      };
    }
    const verification = verifyEvent(event);
    if (!verification.valid) {
      return {
        status: "TAMPERED",
        checkedEvents: index,
        failedSequence: event.sequence,
        failedEventId: event.eventId,
        expectedHash: verification.expectedHash,
        calculatedHash: verification.calculatedHash,
        reason: "Event content hash mismatch"
      };
    }
    previousHash = event.eventHash;
    previousSequence = event.sequence;
  }

  return { status: "VERIFIED", checkedEvents: events.length };
}
