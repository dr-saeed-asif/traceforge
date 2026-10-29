import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("records judge failures separately and gives the judge the complete trace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tf-judge-"));
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(body);
    response.setHeader("content-type", "application/json");
    if (requests.length === 2) { response.statusCode = 503; response.end("{}"); return; }
    response.end(JSON.stringify({ message: { content: JSON.stringify({ verdict: requests.length === 1 ? "VERIFIED" : "unknown", evidenceEventIds: ["e1"], reason: "observed" }) }, prompt_eval_count: 20, eval_count: 4 }));
  });
  try {
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server address");
    const source = join(dir, "sessions.jsonl"), output = join(dir, "predictions.jsonl");
    await writeFile(source, JSON.stringify({ id: "s", family: "fixture", gold: [1, 2, 3].map(i => ({ quote: `claim ${i}`, verdict: "VERIFIED" })), evidence: [{ eventId: "e1", metadata: { workspaceObservation: "incomplete", fileHashAfter: "abc" } }] }));
    await promisify(execFile)(process.execPath, [resolve("research/benchmark/llm-judge.mjs"), "--sessions", source, "--out", output, "--model", "fixture", "--endpoint", `http://127.0.0.1:${address.port}/api/chat`]);
    const rows = (await readFile(output, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(rows.map(row => row.predicted)).toEqual(["VERIFIED", "ERROR", "ERROR"]);
    expect(rows[1].error).toBe("HTTP 503");
    expect(rows[0].usage).toEqual({ inputTokens: 20, outputTokens: 4 });
    expect(JSON.parse(requests[0]!).messages[1].content).toContain("workspaceObservation");
    expect(JSON.parse(requests[0]!).messages[1].content).not.toContain('"gold"');
  } finally {
    await new Promise<void>(done => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  }
});
