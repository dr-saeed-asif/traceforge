"use client";

import { useCallback, useEffect, useState } from "react";
import {
  parseAnchorLookupResponse,
  type AnchorLookupResponse
} from "@traceforge/verification-contracts";
import { Button, ButtonLink, VerdictBadge } from "@/components/ui";
import type { DecodedAnchorPayload } from "./anchor-decoder";
import styles from "./anchor-inspector.module.css";

export function AnchorHashSearch({
  decoded,
  onSelect,
  disabled = false
}: {
  decoded: DecodedAnchorPayload | null;
  onSelect: (promptId: string, claimIndex: number) => void;
  disabled?: boolean;
}) {
  const [kind, setKind] = useState("sessionHash");
  const [hash, setHash] = useState("");
  const [results, setResults] = useState<AnchorLookupResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const search = useCallback(async (params: URLSearchParams, signal?: AbortSignal) => {
    setBusy(true);
    setError("");
    setResults(null);
    try {
      const response = await fetch(`/api/anchor-lookup?${params}`, {
        cache: "no-store",
        signal: signal ?? AbortSignal.timeout(15000)
      });
      const body: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Hash lookup failed."
        );
      const parsed = parseAnchorLookupResponse(body);
      if (!signal?.aborted) setResults(parsed);
    } catch (error) {
      if (!signal?.aborted)
        setError(error instanceof Error ? error.message : "Hash lookup failed.");
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!decoded) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setKind("sessionHash");
      setHash(decoded.sessionHash);
      void search(new URLSearchParams({ sessionHash: decoded.sessionHash }), controller.signal);
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      setBusy(false);
    };
  }, [decoded, search]);

  return (
    <section className={styles.card}>
      <h2>Find the original prompt and claims</h2>
      <p>
        Search the local TraceForge database by sessionHash or manifestHash. Decoding automatically
        searches the session hash. No Prompt ID is needed.
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!/^0x[0-9a-f]{64}$/i.test(hash.trim())) {
            setResults(null);
            setError("Enter 0x followed by 64 hexadecimal characters.");
            return;
          }
          void search(new URLSearchParams({ [kind]: hash.trim() }));
        }}
      >
        <label>
          Search by
          <select
            value={kind}
            disabled={busy || disabled}
            onChange={(event) => {
              setKind(event.target.value);
              setResults(null);
            }}
          >
            <option value="sessionHash">sessionHash — all session claims</option>
            <option value="manifestHash">manifestHash — exact verified claim</option>
          </select>
        </label>
        <label>
          Hash to find
          <input
            value={hash}
            disabled={busy || disabled}
            onChange={(event) => {
              setHash(event.target.value);
              setResults(null);
            }}
            placeholder="0x…"
          />
        </label>
        <div className={styles.actions}>
          <Button type="submit" disabled={busy || disabled}>
            {busy ? "Searching local records…" : "Find original claim"}
          </Button>
        </div>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {results?.matches.length === 0 ? (
        <p role="status">
          No local record found. The data may belong to another TraceForge database, or the original
          claim may have changed. Hashes cannot recover missing records.
        </p>
      ) : null}
      {results?.matches.map((match) => (
        <article key={match.session.promptId}>
          <h3>Original prompt</h3>
          <p className={styles.notice}>
            {match.session.promptQuery ?? "Prompt text is unavailable in this local record."}
          </p>
          <p>
            Agent: {match.session.agentName} · Model: {match.session.modelName} · Project:{" "}
            {match.session.projectName ?? "Unknown"}
          </p>
          <p>
            Prompt ID: <code>{match.session.promptId}</code>
          </p>
          <ButtonLink
            href={`/sessions/${encodeURIComponent(match.session.promptId)}`}
            size="sm"
            variant="secondary"
          >
            Open session and evidence
          </ButtonLink>
          <h3>Claims ({match.claims.length})</h3>
          {match.claims.map((claim) => (
            <div key={claim.claimIndex} className={styles.notice}>
              <p>
                <strong>
                  Claim {claim.claimIndex}
                  {decoded?.claimIndex === claim.claimIndex ? " — decoded claim" : ""}
                </strong>
                : {claim.claimText}
              </p>
              <p>
                <VerdictBadge verdict={claim.verdict} /> · Target: <code>{claim.target}</code>
              </p>
              {claim.explanation ? <p>{claim.explanation}</p> : null}
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || disabled || claim.verdict !== "VERIFIED"}
                onClick={() => onSelect(match.session.promptId, claim.claimIndex)}
              >
                Load claim {claim.claimIndex} for comparison
              </Button>
            </div>
          ))}
        </article>
      ))}
    </section>
  );
}
