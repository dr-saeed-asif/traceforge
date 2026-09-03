import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptStore } from "../src/prompt-store.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PromptStore", () => {
  it("writes both mysql row and opencode activity capture files", async () => {
    const execute = vi.fn(async () => [[], []] as const);
    const dir = await mkdtemp(join(tmpdir(), "traceforge-captures-"));
    cleanup.push(dir);
    const store = new PromptStore({ execute } as never, dir);

    await store.ingest({ runId: "run-1", eventType: "PROMPT_SUBMITTED", payload: { content: "Create form", agent: "OpenCode", model: "gpt-4" } });
    await store.ingest({ runId: "run-1", eventType: "MODEL_RESPONSE", payload: { responseText: "Done" } });
    await store.ingest({ runId: "run-1", eventType: "RESOURCE_ACCESSED", payload: { resourceType: "webpage", url: "https://example.test" } });
    await store.ingest({ runId: "run-1", eventType: "AGENT_COMPLETED", payload: { status: "COMPLETED" } });

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO prompt_results"),
      ["Create form", "OpenCode", "gpt-4", "Done", JSON.stringify([{ resourceType: "webpage", url: "https://example.test" }])]
    );

    const entries = await readdir(dir);
    expect(entries).toContain("index.json");
    const captureFolder = entries.find((value) => value !== "index.json");
    expect(captureFolder).toBeDefined();

    const summary = JSON.parse(await readFile(join(dir, captureFolder!, "summary.json"), "utf8")) as { eventCount: number };
    const resources = JSON.parse(await readFile(join(dir, captureFolder!, "resources.json"), "utf8")) as { resources: unknown[] };
    const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8")) as Array<{ folder: string }>;
    const eventFiles = await readdir(join(dir, captureFolder!, "events"));

    expect(summary.eventCount).toBe(4);
    expect(resources.resources).toEqual([{ resourceType: "webpage", url: "https://example.test" }]);
    expect(index[0]?.folder).toBe(captureFolder);
    expect(eventFiles).toHaveLength(4);
  });
});
