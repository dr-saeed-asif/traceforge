import { describe, expect, it, vi } from "vitest";
import { CentralTraceForgeIngestion } from "../src/ingestion.js";

const context = { taskId: "task-1", sessionId: "session-1", runId: "run-1" };
function event(eventType = "PROMPT_SUBMITTED") {
  return {
    ...context,
    eventType,
    actor: { type: "human", name: "developer" },
    payload: { content: "hello" },
    providerEventId: "provider-event-1",
    evidence: "OBSERVED",
    adapter: "opencode",
    adapterVersion: "1.18.25"
  };
}

describe("central ingestion", () => {
  it("creates contexts through the PostgreSQL registry boundary", async () => {
    const ensure = vi.fn(async () => context);
    const ingestion = new CentralTraceForgeIngestion({ ensure }, { collect: vi.fn() } as never, { markCompleted: vi.fn(), markFailed: vi.fn() });
    await expect(ingestion.ensureContext({ adapter: "opencode", externalSessionId: "external", repository: "repo", workspace: "workspace", developer: "developer" })).resolves.toEqual(context);
    expect(ensure).toHaveBeenCalledOnce();
  });

  it("sends normalized events through the collector and closes completed runs", async () => {
    const collect = vi.fn(async () => ({ status: "APPENDED" as const, event: { eventId: "event-1" } as never }));
    const markCompleted = vi.fn(async () => undefined);
    const ingestion = new CentralTraceForgeIngestion({ ensure: vi.fn() } as never, { collect }, { markCompleted, markFailed: vi.fn() }, () => new Date("2026-08-30T12:00:00.000Z"));
    await expect(ingestion.ingest(event("SESSION_COMPLETED"))).resolves.toEqual({ status: "APPENDED", eventId: "event-1" });
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", eventType: "SESSION_COMPLETED", source: expect.objectContaining({ adapter: "opencode" }) }));
    expect(markCompleted).toHaveBeenCalledWith("run-1", "2026-08-30T12:00:00.000Z");
  });
});
