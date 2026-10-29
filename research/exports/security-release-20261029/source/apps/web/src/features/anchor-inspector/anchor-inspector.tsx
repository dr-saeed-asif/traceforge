"use client";

import { useState } from "react";
import {
  createBlockchainClaimAnchorManifest,
  createBlockchainClaimAnchorPayload,
  type BlockchainClaimAnchorPayload
} from "@traceforge/claim-anchoring";
import {
  parseVerificationSessionDetailsResponse,
  type VerificationSessionDetailsResponse
} from "@traceforge/verification-contracts";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Button } from "@/components/ui";
import { verifyVerifiedClaimAnchor } from "@/features/claim-anchoring/blockchain-anchor-client";
import {
  findSuiClaimAnchor,
  getSuiAnchorDeployment
} from "@/features/sui-claim-anchoring/sui-anchor-client";
import {
  compareAnchorPayloads,
  decodeAnchorInput,
  payloadFields,
  type AnchorChain,
  type DecodedAnchorPayload
} from "./anchor-decoder";
import styles from "./anchor-inspector.module.css";
import { AnchorHashSearch } from "./anchor-hash-search";

const meanings = {
  sessionHash: "SHA-256 of the session/run identity.",
  claimIndex: "Claim number within this session.",
  manifestHash:
    "SHA-256 of the canonical claim manifest, including claim text, evidence references, rule version and verification timestamp.",
  evidenceRoot: "SHA-256 of the ordered evidence-event IDs and hashes.",
  schemaVersion: "Commitment format version."
};

export function AnchorInspector({
  initialPromptId = "",
  initialClaimIndex = "1"
}: {
  initialPromptId?: string;
  initialClaimIndex?: string;
}) {
  const [chain, setChain] = useState<AnchorChain>("sepolia");
  const [input, setInput] = useState("");
  const [promptId, setPromptId] = useState(initialPromptId);
  const [claimIndex, setClaimIndex] = useState(initialClaimIndex);
  const [decoded, setDecoded] = useState<DecodedAnchorPayload | null>(null);
  const [loaded, setLoaded] = useState<{
    details: VerificationSessionDetailsResponse;
    index: number;
    expected: BlockchainClaimAnchorPayload;
    manifest: unknown;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [chainResult, setChainResult] = useState("");
  const [busy, setBusy] = useState(false);
  const comparisons = decoded && loaded ? compareAnchorPayloads(decoded, loaded.expected) : null;
  const matches = comparisons?.every((field) => field.matches) ?? false;

  function decode() {
    setDecoded(null);
    setMessage("");
    setChainResult("");
    try {
      setDecoded(decodeAnchorInput(chain, input));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not decode this transaction.");
    }
  }

  async function loadClaim(requestedPromptId = promptId, requestedClaimIndex = claimIndex) {
    setBusy(true);
    setLoaded(null);
    setMessage("");
    setChainResult("");
    try {
      const index = Number(requestedClaimIndex);
      if (!requestedPromptId.trim() || !Number.isSafeInteger(index) || index < 0)
        throw new Error("Enter a prompt ID and a non-negative integer claim index.");
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(requestedPromptId.trim())}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(15000)
        }
      );
      if (!response.ok)
        throw new Error(
          "Could not load this TraceForge session. Check the prompt ID and API availability."
        );
      const details = parseVerificationSessionDetailsResponse(await response.json());
      const claim = details.claims.find((candidate) => candidate.claimIndex === index);
      if (!claim) throw new Error("That claim index was not found in this session.");
      // Recompute with the schema of the decoded transaction when it is a
      // supported legacy version; new anchors use the current schema.
      const manifest = createBlockchainClaimAnchorManifest(
        details.session,
        claim,
        details.traceEvents,
        decoded?.schemaVersion === 1 ? 1 : undefined
      );
      const expected = await createBlockchainClaimAnchorPayload(manifest);
      setLoaded({ details, index, expected, manifest });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the claim.");
    } finally {
      setBusy(false);
    }
  }

  async function checkChain() {
    if (!loaded || !matches) return;
    setBusy(true);
    setChainResult("");
    try {
      if (chain === "sepolia") {
        const claim = loaded.details.claims.find((value) => value.claimIndex === loaded.index)!;
        const result = await verifyVerifiedClaimAnchor(
          loaded.details.session,
          claim,
          loaded.details.traceEvents
        );
        setChainResult(
          result.matches
            ? "Stored Sepolia commitment matches this decoded payload and the saved TraceForge claim."
            : result.recordFound
              ? `Stored Sepolia commitment differs: ${result.mismatches.join(", ")}.`
              : "No verified record was found on Sepolia."
        );
      } else {
        const client = new SuiGrpcClient({
          network: "testnet",
          baseUrl: "https://fullnode.testnet.sui.io:443"
        });
        const result = await findSuiClaimAnchor(client, loaded.expected, getSuiAnchorDeployment());
        setChainResult(
          result?.matches
            ? "Stored Sui Testnet commitment matches this decoded payload and the saved TraceForge claim."
            : result
              ? "A stored Sui commitment exists but differs from this claim."
              : "No anchor was found in the configured Sui Testnet registry."
        );
      }
    } catch (error) {
      setChainResult(
        error instanceof Error
          ? error.message
          : "The blockchain read failed. No validation result is available."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <h2>What can be decoded?</h2>
        <p>
          Both chains receive the same five commitment fields. Sepolia uses Ethereum ABI calldata;
          Sui uses a Move call with BCS arguments, plus registry, admin-capability and clock
          objects.
        </p>
        <p className={styles.notice}>
          This is decoding, not decryption. Hashes cannot reveal the original prompt, code or claim
          text. Load the saved claim below to inspect its manifest and recompute the fingerprints.
          Decoding alone does not prove a transaction succeeded or used the configured contract.
        </p>
      </section>
      <section className={styles.card}>
        <h2>1. Decode submitted data</h2>
        <div className={styles.form}>
          <label>
            Chain
            <select
              value={chain}
              disabled={busy}
              onChange={(event) => {
                setChain(event.target.value as AnchorChain);
                setDecoded(null);
                setChainResult("");
              }}
            >
              <option value="sepolia">Ethereum Sepolia</option>
              <option value="sui">Sui Testnet</option>
            </select>
          </label>
          <label>
            {chain === "sepolia" ? "Transaction input data" : "Sui transaction JSON or BCS bytes"}
            <textarea
              value={input}
              disabled={busy}
              onChange={(event) => {
                setInput(event.target.value);
                setDecoded(null);
                setChainResult("");
              }}
              placeholder={
                chain === "sepolia"
                  ? "0xbd115039… (complete input, not a transaction hash)"
                  : "Paste the complete explorer JSON (including rawTransaction), Sui JSON-RPC response, SDK Transaction JSON, or base64/0x BCS TransactionData. A digest alone cannot be decoded."
              }
            />
          </label>
          <div className={styles.actions}>
            <Button onClick={decode} disabled={busy}>
              Decode input
            </Button>
          </div>
        </div>
      </section>
      <AnchorHashSearch
        decoded={decoded}
        disabled={busy}
        onSelect={(selectedPrompt, selectedIndex) => {
          setPromptId(selectedPrompt);
          setClaimIndex(String(selectedIndex));
          void loadClaim(selectedPrompt, String(selectedIndex));
        }}
      />
      <section className={styles.card}>
        <h2>2. Recompute from a saved claim</h2>
        <div className={styles.form}>
          <label>
            Prompt ID
            <input
              value={promptId}
              disabled={busy}
              onChange={(event) => {
                setPromptId(event.target.value);
                setLoaded(null);
                setChainResult("");
              }}
            />
          </label>
          <label>
            Claim index
            <input
              type="number"
              min="0"
              step="1"
              value={claimIndex}
              disabled={busy}
              onChange={(event) => {
                setClaimIndex(event.target.value);
                setLoaded(null);
                setChainResult("");
              }}
            />
          </label>
          <div className={styles.actions}>
            <Button onClick={() => void loadClaim()} disabled={busy}>
              {busy ? "Checking…" : "Load claim and recompute hashes"}
            </Button>
          </div>
        </div>
        {loaded ? (
          <>
            <p>
              Loaded claim {loaded.index} from prompt {loaded.details.session.promptId}.
            </p>
            <details>
              <summary>Original claim manifest (stored in TraceForge, off-chain)</summary>
              <pre className={styles.code}>{JSON.stringify(loaded.manifest, null, 2)}</pre>
            </details>
          </>
        ) : null}
      </section>
      {message ? (
        <p role="alert" className={styles.notice}>
          {message}
        </p>
      ) : null}
      {decoded || loaded ? (
        <section className={styles.card}>
          <h2>Decoded fields and comparison</h2>
          <p role="status">
            {comparisons
              ? matches
                ? "All five decoded fields match the recomputed TraceForge commitment. On-chain presence still needs to be checked."
                : "The decoded input differs from the saved claim. Review the fields below."
              : decoded
                ? "Input decoded. Load a saved claim to compare the fingerprints."
                : "Expected commitment computed. Decode transaction input to compare it."}
          </p>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Decoded value</th>
                  <th scope="col">Expected from TraceForge</th>
                  <th scope="col">Check</th>
                </tr>
              </thead>
              <tbody>
                {payloadFields.map((field) => (
                  <tr key={field}>
                    <th scope="row">
                      {field}
                      <p>{meanings[field]}</p>
                    </th>
                    <td>
                      <code>{decoded?.[field] ?? "—"}</code>
                    </td>
                    <td>
                      <code>{loaded?.expected[field] ?? "Not loaded"}</code>
                    </td>
                    <td>
                      {comparisons?.find((value) => value.field === field)?.matches === true
                        ? "Match"
                        : comparisons
                          ? "Different"
                          : "Not compared"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>3. Check the stored blockchain record</h2>
          <p>
            Checks the configured TraceForge registry. Sepolia reads use MetaMask and may request a
            switch to Sepolia. Sui reads use the Testnet RPC. No transaction is submitted.
          </p>
          <Button onClick={() => void checkChain()} disabled={busy || !matches}>
            Check stored anchor
          </Button>
          {chainResult ? <p role="status">{chainResult}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
