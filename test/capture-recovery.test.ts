import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PromptStore, type CaptureEvent } from "../src/prompt-store.js";

const cleanup: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "traceforge-recovery-"));
  cleanup.push(dir);
  // Models the database UNIQUE PromptId constraint, including ambiguous successful inserts.
  const rows = new Map<string, unknown[]>();
  const execute = vi.fn(async (_sql: string, parameters: unknown[]) => {
    const id = String(parameters[9]);
    if (!rows.has(id)) rows.set(id, parameters);
    return [[], []];
  });
  const restart = () => new PromptStore({ execute } as never, dir, Buffer.alloc(32, 7));
  return { dir, rows, execute, restart, store: restart() };
}

function event(eventType: string, eventId: string, extra: Partial<CaptureEvent> = {}): CaptureEvent {
  return { runId: "run-b", sessionId: "session-b", projectName: "project-b", projectPath: "H:/projects/project-b", promptId: "prompt-b", eventType, eventId, ...extra };
}
const start = event("PROMPT_SUBMITTED", "submit", { payload: { content: "Create login", agent: "build", model: "test-model" } });
const response = event("MODEL_RESPONSE", "response", { payload: { role: "assistant", messageId: "assistant-1", partId: "part-1", responseText: "Done" } });
const end = event("AGENT_COMPLETED", "complete");

it("recovers an unfinished prompt after restart and deduplicates events and assistant parts", async () => {
  const f = await fixture();
  await f.store.ingest(start);
  await f.store.ingest(response);
  expect(f.rows.size).toBe(0);
  const restarted = f.restart();
  await restarted.initialize();
  await restarted.ingest(start); // replayed request must not finalize/reopen the prompt
  await restarted.ingest(response);
  await restarted.ingest({ ...response, eventId: "different-delivery-id" });
  await restarted.ingest(end);
  await restarted.ingest(end);
  expect(f.rows.size).toBe(1);
  expect(f.rows.get("prompt-b")?.[3]).toBe("Done");
  expect(f.rows.get("prompt-b")?.slice(9)).toEqual(["prompt-b", "session-b", "run-b", "project-b", "H:/projects/project-b", "COMPLETED"]);
  await f.restart().initialize();
  expect(f.rows.size).toBe(1);
  const index = JSON.parse(await readFile(join(f.dir, "index.json"), "utf8"));
  expect(index).toHaveLength(1);
  const saved = JSON.parse(await readFile(join(f.dir, index[0].folder, "prompt.json"), "utf8"));
  expect(saved).toMatchObject({ projectName: "project-b", projectPath: "H:/projects/project-b", sessionId: "session-b", promptId: "prompt-b" });
});

it("retries a database failure without poisoning the run or duplicating response text", async () => {
  const f = await fixture();
  await f.store.ingest(start);
  await f.store.ingest(response);
  f.execute.mockRejectedValueOnce(new Error("database temporarily unavailable"));
  await expect(f.store.ingest(end)).rejects.toThrow("temporarily unavailable");
  await f.store.ingest(end);
  expect(f.rows.size).toBe(1);
  expect(f.rows.get("prompt-b")?.[3]).toBe("Done");
});

it("repairs capture files after SQL succeeded but file writing failed", async () => {
  const f = await fixture();
  await f.store.ingest(start);
  await f.store.ingest(response);
  vi.spyOn(f.store as any, "writeCaptureFiles").mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(f.store.ingest(end)).rejects.toThrow("disk unavailable");
  expect(f.rows.size).toBe(1);
  await f.restart().initialize();
  expect(f.rows.size).toBe(1);
  expect(JSON.parse(await readFile(join(f.dir, "index.json"), "utf8"))).toHaveLength(1);
});

it("separates repeated prompt text and ignores late responses for a previous prompt", async () => {
  const f = await fixture();
  await f.store.ingest(start);
  await f.store.ingest(response);
  await f.store.ingest(end);
  await f.store.ingest({ ...start, eventId: "submit-2", promptId: "prompt-2" });
  await f.store.ingest({ ...response, eventId: "late-part", payload: { responseText: "Old response" } });
  await f.store.ingest({ ...response, eventId: "user-part", promptId: "prompt-2", payload: { role: "user", responseText: "User prompt" } });
  await f.store.ingest({ ...end, eventId: "end-2", promptId: "prompt-2" });
  expect(f.rows.size).toBe(2);
  expect(f.rows.get("prompt-2")?.[3]).toBe("NOT_AVAILABLE");
  const folders = (await readdir(f.dir)).filter(name => !name.startsWith(".") && name !== "index.json");
  expect(folders).toHaveLength(2);
});

it("keeps every capture index entry when independent runs complete concurrently", async () => {
  const f = await fixture();
  await Promise.all(["a", "b", "c"].map(async id => {
    const identity = { runId: `run-${id}`, promptId: `prompt-${id}` };
    await f.store.ingest({ ...start, ...identity });
    await f.store.ingest({ ...end, ...identity });
  }));
  expect(JSON.parse(await readFile(join(f.dir, "index.json"), "utf8"))).toHaveLength(3);
});

it("records interruption and failure status accurately", async () => {
  const f = await fixture();
  await f.store.ingest(start);
  await f.store.ingest({ ...start, eventId: "submit-2", promptId: "prompt-2" });
  await f.store.ingest({ ...end, eventType: "AGENT_FAILED", promptId: "prompt-2" });
  expect(f.rows.get("prompt-b")?.[14]).toBe("INTERRUPTED");
  expect(f.rows.get("prompt-2")?.[14]).toBe("FAILED");
});
