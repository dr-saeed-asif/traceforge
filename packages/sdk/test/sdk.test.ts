import type { ArtifactStore, Clock, IdGenerator, StoredArtifact } from "@traceforge/application";
import { sha256 } from "@traceforge/crypto";
import {
  InMemoryDurableBuffer,
  InMemoryEventRepository,
  ProvenanceCollector,
  type BufferedIngressEvent
} from "@traceforge/collector";
import { verifyArtifact, verifyEventChain } from "@traceforge/provenance";
import { CollectorTraceTransport, Traceforge } from "../src/index.js";
import { describe, expect, it } from "vitest";

class FixedClock implements Clock {
  private milliseconds = Date.parse("2026-08-22T10:00:00.000Z");
  public now(): Date { const value = new Date(this.milliseconds); this.milliseconds += 10; return value; }
}

class SequentialIds implements IdGenerator {
  private value = 0;
  public generate(): string { this.value += 1; return `sdk-id-${this.value}`; }
}

class MemoryArtifacts implements ArtifactStore {
  public readonly values = new Map<string, Uint8Array>();
  public async put(content: Uint8Array): Promise<StoredArtifact> {
    const contentHash = sha256(content);
    const deduplicated = this.values.has(contentHash);
    this.values.set(contentHash, content.slice());
    return { storageReference: `memory:${contentHash}`, contentHash, size: content.byteLength, deduplicated };
  }
  public async get(hash: string) { return this.values.get(hash)?.slice() ?? null; }
  public async exists(hash: string) { return this.values.has(hash); }
}

async function fixture() {
  const repository = new InMemoryEventRepository();
  const buffer = new InMemoryDurableBuffer<BufferedIngressEvent>();
  const artifacts = new MemoryArtifacts();
  const clock = new FixedClock();
  const ids = new SequentialIds();
  const collector = new ProvenanceCollector(repository, buffer, clock, ids);
  await collector.start();
  const sdk = new Traceforge(new CollectorTraceTransport(collector, artifacts), clock, ids);
  const run = sdk.startRun({
    task: "Create component", repository: "repo", workspace: "workspace", developer: "developer-1",
    agent: { id: "agent-1", name: "Test Agent", version: "1.0.0" }
  });
  return { repository, buffer, artifacts, collector, run };
}

describe("Traceforge SDK", () => {
  it("records a complete, verifiable workflow and artifact", async () => {
    const { repository, artifacts, collector, run } = await fixture();
    await run.recordPrompt("password=never-store-this");
    await run.recordModelInvocation({
      provider: "example", model: "model-1", requestId: "request-1",
      inputTokens: 3, outputTokens: 4, response: { summary: "visible summary" }
    });
    expect(await run.recordToolCall("reader", { path: "src/a.ts" }, async () => ({ found: true }))).toEqual({ found: true });
    const recorded = await run.recordArtifact({
      relativePath: "src/new.ts", mimeType: "text/typescript", content: "export const value = 1;\n"
    });
    await run.complete();

    const events = await repository.listRunEvents(run.context.runId);
    expect(events.map((event) => event.eventType)).toEqual([
      "TASK_CREATED", "SESSION_STARTED", "AGENT_STARTED", "PROMPT_SUBMITTED",
      "MODEL_REQUEST", "MODEL_RESPONSE", "TOOL_STARTED", "TOOL_COMPLETED",
      "FILE_CREATED", "ARTIFACT_CREATED", "AGENT_COMPLETED", "RUN_COMPLETED", "SESSION_COMPLETED"
    ]);
    expect(verifyEventChain(events).status).toBe("VERIFIED");
    expect(JSON.stringify(events)).not.toContain("never-store-this");
    const bytes = await artifacts.get(recorded.contentHash);
    expect(bytes).not.toBeNull();
    expect(verifyArtifact(bytes!, {
      algorithm: "sha256", hash: recorded.contentHash, size: recorded.size,
      timestamp: "2026-08-22T10:00:00.000Z"
    }).valid).toBe(true);
    await collector.stop();
  });

  it("records failed tool activity without blocking run completion", async () => {
    const { repository, collector, run } = await fixture();
    await expect(run.recordToolCall("broken-tool", {}, async () => { throw new Error("token=top-secret"); }))
      .rejects.toThrow("token=top-secret");
    await run.complete();
    const events = await repository.listRunEvents(run.context.runId);
    expect(events.map((event) => event.eventType)).toContain("ERROR");
    expect(JSON.stringify(events)).not.toContain("top-secret");
    expect(events.at(-2)?.eventType).toBe("RUN_COMPLETED");
    await collector.stop();
  });

  it("rejects activity after completion", async () => {
    const { collector, run } = await fixture();
    await run.complete();
    await expect(run.recordPrompt("late prompt")).rejects.toMatchObject({ code: "RUN_COMPLETED" });
    await expect(run.complete()).rejects.toMatchObject({ code: "RUN_ALREADY_COMPLETED" });
    await collector.stop();
  });

  it("records explicit human approval without inferring it from artifact creation", async () => {
    const { repository, collector, run } = await fixture();
    const artifact = await run.recordArtifact({
      relativePath: "approved.ts", mimeType: "text/typescript", content: "export {};\n"
    });
    const beforeApproval = await repository.listRunEvents(run.context.runId);
    expect(beforeApproval.map((event) => event.eventType)).not.toContain("HUMAN_APPROVAL");
    await run.recordApproval({
      target: { artifactId: artifact.artifactId }, reviewer: "reviewer-1",
      decision: "APPROVED", comment: "Reviewed locally"
    });
    const commitId = "a".repeat(40);
    await run.recordGitCommit({
      repository: "repo", branch: "main", baseCommit: "b".repeat(40), commitId,
      author: "reviewer-1", authorEmail: "reviewer@example.test",
      timestamp: "2026-08-22T10:05:00.000Z",
      changedFiles: [{
        path: artifact.relativePath, operation: "CREATED", beforeHash: null,
        afterHash: artifact.contentHash, diffHash: "c".repeat(64)
      }]
    }, {
      runId: run.context.runId, repository: "repo", commitId, evidence: "CONFIRMED",
      matchedArtifactIds: [artifact.artifactId], unmatchedArtifactIds: []
    });
    await run.complete();
    const finalEvents = await repository.listRunEvents(run.context.runId);
    const approval = finalEvents.find((event) => event.eventType === "HUMAN_APPROVAL");
    expect(approval?.actor).toMatchObject({ type: "human", id: "reviewer-1" });
    expect(approval?.payload).toMatchObject({ artifactId: artifact.artifactId, decision: "APPROVED" });
    expect(finalEvents.find((event) => event.eventType === "GIT_COMMIT_CREATED")?.payload)
      .toMatchObject({ commitId, association: { evidence: "CONFIRMED" } });
    await collector.stop();
  });
});
