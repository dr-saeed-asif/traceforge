#!/usr/bin/env node
/**
 * TraceForge claim gate — an MCP server (stdio) that lets a *different* agent
 * (a reviewer, a CI agent, an orchestrator) obtain and check the signed claim
 * record of another agent's work before relying on its completion report.
 *
 * Tools:
 *   traceforge_get_claim_record   { promptId }                    → DSSE envelope
 *   traceforge_workspace_digest   { path }                        → sha256 of the received artifact
 *   traceforge_check_claim_record { envelope, artifactDigest, requireVerifiedTest? } → ACCEPT / REVIEW / REJECT
 *
 * Environment: TRACEFORGE_API_URL, TRACEFORGE_API_TOKEN, and optionally
 * TRACEFORGE_RECORD_PUBLIC_KEY_FILE (pin the verifier key instead of fetching it).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  decideOnClaimRecord,
  type DsseEnvelope,
} from "./modules/verification/application/claim-record.js";
import { computeWorkspaceDigest } from "./modules/verification/application/workspace-digest.js";

export interface GateServerOptions {
  readonly fetchRecord: (promptId: string) => Promise<DsseEnvelope>;
  readonly publicKeyPem: () => Promise<string>;
}

export function createClaimGateServer(options: GateServerOptions): McpServer {
  const server = new McpServer({ name: "traceforge-claim-gate", version: "0.1.0" });
  const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

  server.registerTool(
    "traceforge_get_claim_record",
    {
      title: "Get a signed TraceForge claim record",
      description: "Returns the verifier-signed, artifact-bound record of every claim in an agent's completion report, with verdicts and evidence hashes.",
      inputSchema: { promptId: z.string().min(1) },
    },
    async ({ promptId }) => text(await options.fetchRecord(promptId)),
  );

  server.registerTool(
    "traceforge_workspace_digest",
    {
      title: "Digest a received workspace",
      description: "Computes the workspace digest of a local directory with the same algorithm as the TraceForge capture layer, to compare with a record's subject.",
      inputSchema: { path: z.string().min(1) },
    },
    async ({ path }) => text({ sha256: await computeWorkspaceDigest(path) }),
  );

  server.registerTool(
    "traceforge_check_claim_record",
    {
      title: "Decide whether to rely on a completion report",
      description: "Verifies the record signature and artifact binding, then returns ACCEPT, REVIEW or REJECT with reasons.",
      inputSchema: {
        envelope: z.object({
          payloadType: z.string(),
          payload: z.string(),
          signatures: z.array(z.object({ keyid: z.string(), sig: z.string() })),
        }),
        artifactDigest: z.string().regex(/^[0-9a-f]{64}$/u),
        requireVerifiedTest: z.boolean().optional(),
      },
    },
    async ({ envelope, artifactDigest, requireVerifiedTest }) =>
      text(
        decideOnClaimRecord(envelope, await options.publicKeyPem(), artifactDigest, {
          ...(requireVerifiedTest === undefined ? {} : { requireVerifiedTest }),
        }),
      ),
  );
  return server;
}

async function main(): Promise<void> {
  const base = (process.env.TRACEFORGE_API_URL ?? "http://127.0.0.1:8080").replace(/\/$/u, "");
  const headers = { authorization: `Bearer ${process.env.TRACEFORGE_API_TOKEN ?? ""}` };
  const getJson = async (path: string) => {
    const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}`);
    return response.json();
  };
  const pinned = process.env.TRACEFORGE_RECORD_PUBLIC_KEY_FILE;
  const server = createClaimGateServer({
    fetchRecord: async (promptId) =>
      (await getJson(`/api/v1/verification/sessions/${encodeURIComponent(promptId)}/claim-record`)) as DsseEnvelope,
    publicKeyPem: async () =>
      pinned ? readFileSync(pinned, "utf8") : ((await getJson("/api/v1/verification/record-key")) as { publicKeyPem: string }).publicKeyPem,
  });
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  });
}
