import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptStore } from "../src/prompt-store.js";
import type { VerificationRepository } from "../src/modules/verification/index.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PromptStore verification persistence", () => {
  it("creates a session, appends mapped evidence, and links the legacy result", async () => {
    const save = vi.fn(async () => 42);
    const repository = {
      createSession: vi.fn(async () => undefined),
      attachPromptResult: vi.fn(async () => undefined),
      appendTraceEvent: vi.fn(async () => ({ traceEventId: 1, sequenceNumber: 1, eventHash: "hash", deduplicated: false })),
      loadVerificationEvidence: vi.fn(async () => [{
        promptId: "prompt-1",
        eventId: "event-test",
        sequenceNumber: 3,
        eventType: "TEST_COMPLETED",
        outcome: "SUCCEEDED",
        occurredAt: "2026-01-01T00:00:02.000Z",
        target: "npm test",
        metadata: { exitCode: 0, passed: 12, failed: 0 }
      }]),
      saveExtractedClaim: vi.fn(async () => undefined),
      saveClaimVerification: vi.fn(async () => undefined),
      updateSessionSummary: vi.fn(async () => undefined)
    } as unknown as VerificationRepository;
    const captureDir = await mkdtemp(join(tmpdir(), "traceforge-verification-"));
    cleanup.push(captureDir);
    const store = new PromptStore({ save }, captureDir, Buffer.alloc(32, 7), repository);

    await store.ingest({ runId: "run-1", promptId: "prompt-1", sessionId: "session-1", projectName: "TraceForge", projectPath: "H:/traceforge", eventId: "event-prompt", occurredAt: "2026-01-01T00:00:00.000Z", eventType: "PROMPT_SUBMITTED", payload: { content: "Implement phase 3", agent: "OpenCode", model: "gpt-5" } });
    await store.ingest({ runId: "run-1", promptId: "prompt-1", sessionId: "session-1", eventId: "event-response", occurredAt: "2026-01-01T00:00:01.000Z", eventType: "MODEL_RESPONSE", payload: { responseText: "All tests passed" } });
    await store.ingest({ runId: "run-1", promptId: "prompt-1", sessionId: "session-1", eventId: "event-test", occurredAt: "2026-01-01T00:00:02.000Z", eventType: "COMMAND_COMPLETED", payload: { command: "npm test", exitCode: 0, passed: 12, failed: 0 } });
    await store.ingest({ runId: "run-1", promptId: "prompt-1", sessionId: "session-1", eventId: "event-complete", occurredAt: "2026-01-01T00:00:03.000Z", eventType: "AGENT_COMPLETED", payload: { status: "COMPLETED" } });

    expect(repository.createSession).toHaveBeenCalledWith(expect.objectContaining({ promptId: "prompt-1", externalSessionId: "session-1", runId: "run-1", policyVersion: "2.0.0" }));
    expect(repository.appendTraceEvent).toHaveBeenCalledTimes(4);
    expect((repository.appendTraceEvent as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].eventType)).toEqual([
      "PROMPT_SUBMITTED", "FINAL_RESPONSE_CAPTURED", "TEST_COMPLETED", "AGENT_COMPLETED"
    ]);
    expect((repository.appendTraceEvent as ReturnType<typeof vi.fn>).mock.calls[1]?.[0].metadata).toMatchObject({ responseHash: expect.any(String) });
    expect(repository.saveExtractedClaim).toHaveBeenCalledWith(expect.objectContaining({ claimType: "TEST_PASSED", target: "test execution" }));
    expect(repository.saveClaimVerification).toHaveBeenCalledWith(expect.objectContaining({ verdict: "VERIFIED", reasonCode: "REQUIRED_EVIDENCE_CONFIRMED" }));
    expect(repository.attachPromptResult).toHaveBeenCalledWith("prompt-1", 42);
    expect(repository.updateSessionSummary).toHaveBeenLastCalledWith(expect.objectContaining({ promptId: "prompt-1", executionStatus: "COMPLETED", extractionStatus: "SUCCEEDED", verificationStatus: "SUCCEEDED", completedAt: "2026-01-01T00:00:03.000Z", summary: expect.objectContaining({ reliabilityPercent: 100 }) }));
  });
});
