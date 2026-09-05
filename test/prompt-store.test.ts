import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptStore } from "../src/prompt-store.js";
import { decryptGeneratedCode, type EncryptedGeneratedCode } from "../src/generated-code-crypto.js";

const cleanup: string[] = [];
const generatedCodeKey = Buffer.alloc(32, 7);

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PromptStore", () => {
  it("writes both mysql row and opencode activity capture files", async () => {
    const execute = vi.fn(async () => [[], []] as const);
    const dir = await mkdtemp(join(tmpdir(), "traceforge-captures-"));
    cleanup.push(dir);
    const store = new PromptStore({ execute } as never, dir, generatedCodeKey);

    await store.ingest({ runId: "run-1", eventType: "PROMPT_SUBMITTED", payload: { content: "Create form", agent: "OpenCode", model: "gpt-4" } });
    await store.ingest({ runId: "run-1", eventType: "MODEL_RESPONSE", payload: { responseText: "Done" } });
    await store.ingest({ runId: "run-1", eventType: "RESOURCE_ACCESSED", payload: { resourceType: "webpage", url: "https://example.test" } });
    await store.ingest({ runId: "run-1", eventType: "RESOURCE_ACCESSED", payload: { resourceType: "file", path: "src\\index.ts" } });
    await store.ingest({ runId: "run-1", eventType: "RESOURCE_ACCESSED", payload: { resourceType: "directory", path: "src/components" } });
    await store.ingest({ runId: "run-1", eventType: "RESOURCE_ACCESSED", payload: { resourceType: "file", path: "src/index.ts" } });
    await store.ingest({ runId: "run-1", eventType: "AGENT_COMPLETED", payload: { status: "COMPLETED" } });

expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO prompt_results"),
      [
        "Create form",
        "OpenCode",
        "gpt-4",
        "Done",
        JSON.stringify([
          { resourceType: "webpage", url: "https://example.test" },
          { resourceType: "file", path: "src\\index.ts" },
          { resourceType: "directory", path: "src/components" },
          { resourceType: "file", path: "src/index.ts" }
        ]),
        JSON.stringify(["src/index.ts", "src/components"]),
"[]",
        expect.any(String),
        "NOT_AVAILABLE"
      ]
    );

    const entries = await readdir(dir);
    expect(entries).toContain("index.json");
    const captureFolder = entries.find((value) => value !== "index.json");
    expect(captureFolder).toBeDefined();

    const summary = JSON.parse(await readFile(join(dir, captureFolder!, "summary.json"), "utf8")) as { eventCount: number };
    const prompt = JSON.parse(await readFile(join(dir, captureFolder!, "prompt.json"), "utf8")) as { filePaths: string[] };
    const resources = JSON.parse(await readFile(join(dir, captureFolder!, "resources.json"), "utf8")) as { resources: unknown[] };
    const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8")) as Array<{ folder: string }>;
    const eventFiles = await readdir(join(dir, captureFolder!, "events"));

    expect(summary.eventCount).toBe(7);
    expect(resources.resources).toHaveLength(4);
    expect(prompt.filePaths).toEqual(["src/index.ts", "src/components"]);
    expect(index[0]?.folder).toBe(captureFolder);
    expect(eventFiles).toHaveLength(7);
  });

  it("stores the latest complete code for every generated file", async () => {
    const execute = vi.fn(async () => [[], []] as const);
    const dir = await mkdtemp(join(tmpdir(), "traceforge-captures-"));
    cleanup.push(dir);
    const store = new PromptStore({ execute } as never, dir, generatedCodeKey);

    await store.ingest({ runId: "run-code", eventType: "PROMPT_SUBMITTED", payload: { content: "Create app", agent: "OpenCode", model: "gpt-4" } });
    await store.ingest({ runId: "run-code", eventType: "GENERATED_CODE_CAPTURED", payload: { path: "src\\app.ts", code: "const version = 1;" } });
    await store.ingest({ runId: "run-code", eventType: "GENERATED_CODE_CAPTURED", payload: { path: "src/app.ts", code: "const version = 2;" } });
    await store.ingest({ runId: "run-code", eventType: "GENERATED_CODE_CAPTURED", payload: { path: "src/view.ts", code: "export const view = true;" } });
    await store.ingest({ runId: "run-code", eventType: "AGENT_COMPLETED", payload: { status: "COMPLETED" } });

    const generatedCode = [
      { path: "src/app.ts", code: "const version = 2;" },
      { path: "src/view.ts", code: "export const view = true;" }
    ];
expect(execute).toHaveBeenCalledWith(expect.stringContaining("`GeneratedCode`"), [
      "Create app", "OpenCode", "gpt-4", "NOT_AVAILABLE", "[]", "[]", JSON.stringify(generatedCode), expect.any(String), "NOT_AVAILABLE"
    ]);
    const parameters = execute.mock.calls[0]?.[1] as unknown[];
    const encrypted = JSON.parse(String(parameters[7])) as EncryptedGeneratedCode;
    expect(decryptGeneratedCode(encrypted, generatedCodeKey)).toEqual(generatedCode);
    expect(encrypted.ciphertext).not.toContain("const version");

    const captureFolder = (await readdir(dir)).find((value) => value !== "index.json");
    const stored = JSON.parse(await readFile(join(dir, captureFolder!, "generated-code.json"), "utf8")) as { generatedCode: unknown[] };
    const summary = JSON.parse(await readFile(join(dir, captureFolder!, "summary.json"), "utf8")) as { artifactCount: number };
    expect(stored.generatedCode).toEqual(generatedCode);
    expect(summary.artifactCount).toBe(2);
  });

  it("projects response links as referenced resources without claiming they were fetched", async () => {
    const execute = vi.fn(async () => [[], []] as const);
    const dir = await mkdtemp(join(tmpdir(), "traceforge-captures-"));
    cleanup.push(dir);
    const store = new PromptStore({ execute } as never, dir, generatedCodeKey);

    await store.ingest({ runId: "run-links", eventType: "PROMPT_SUBMITTED", payload: { content: "Recommend tutorials", agent: "OpenCode", model: "gpt-4" } });
    await store.ingest({ runId: "run-links", eventType: "MODEL_RESPONSE", payload: { responseText: "Use https://docs.python.org/3/tutorial/, realpython.com, and react.dev." } });
    await store.ingest({ runId: "run-links", eventType: "AGENT_COMPLETED", payload: { status: "COMPLETED" } });

    const resources = [
      { resourceType: "webpage", accessType: "referenced", source: "model-response", url: "https://docs.python.org/3/tutorial/" },
      { resourceType: "webpage", accessType: "referenced", source: "model-response", url: "https://realpython.com/" },
      { resourceType: "webpage", accessType: "referenced", source: "model-response", url: "https://react.dev/" }
    ];
expect(execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO prompt_results"), [
      "Recommend tutorials", "OpenCode", "gpt-4", "Use https://docs.python.org/3/tutorial/, realpython.com, and react.dev.", JSON.stringify(resources), "[]", "[]", expect.any(String), "NOT_AVAILABLE"
    ]);

    const captureFolder = (await readdir(dir)).find((value) => value !== "index.json");
    const stored = JSON.parse(await readFile(join(dir, captureFolder!, "resources.json"), "utf8") as string) as { resources: unknown[] };
    expect(stored.resources).toEqual(resources);
  });

  it("prefers a fetched resource over the same URL referenced in the response", async () => {
    const execute = vi.fn(async () => [[], []] as const);
    const dir = await mkdtemp(join(tmpdir(), "traceforge-captures-"));
    cleanup.push(dir);
    const store = new PromptStore({ execute } as never, dir, generatedCodeKey);

    const fetched = { resourceType: "webpage", accessType: "read", tool: "webfetch", url: "https://example.test/docs" };
    await store.ingest({ runId: "run-fetched", eventType: "PROMPT_SUBMITTED", payload: { content: "Read docs", agent: "OpenCode", model: "gpt-4" } });
    await store.ingest({ runId: "run-fetched", eventType: "RESOURCE_ACCESSED", payload: fetched });
    await store.ingest({ runId: "run-fetched", eventType: "MODEL_RESPONSE", payload: { responseText: "See https://example.test/docs" } });
    await store.ingest({ runId: "run-fetched", eventType: "AGENT_COMPLETED", payload: { status: "COMPLETED" } });

expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO prompt_results"),
      ["Read docs", "OpenCode", "gpt-4", "See https://example.test/docs", JSON.stringify([fetched]), "[]", "[]", expect.any(String), "NOT_AVAILABLE"]
    );
  });
});
