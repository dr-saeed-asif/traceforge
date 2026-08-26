import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sha256 } from "@traceforge/crypto";
import { afterEach, describe, expect, it } from "vitest";
import { correlateArtifacts, GitCliAdapter } from "../src/index.js";

const execute = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

async function git(repository: string, args: readonly string[]): Promise<string> {
  const result = await execute("git", ["-C", repository, ...args], { windowsHide: true, encoding: "utf8" });
  return result.stdout;
}

async function repositoryFixture() {
  const directory = await mkdtemp(join(tmpdir(), "traceforge-git-"));
  directories.push(directory);
  await git(directory, ["init"]);
  await git(directory, ["config", "user.name", "Trace Tester"]);
  await git(directory, ["config", "user.email", "trace@example.test"]);
  await writeFile(join(directory, "existing.ts"), "export const value = 1;\n", "utf8");
  await git(directory, ["add", "--", "existing.ts"]);
  await git(directory, ["commit", "-m", "initial"]);
  const baseCommit = (await git(directory, ["rev-parse", "HEAD"])).trim();
  await writeFile(join(directory, "existing.ts"), "export const value = 2;\n", "utf8");
  await writeFile(join(directory, "created.ts"), "export const created = true;\n", "utf8");
  await git(directory, ["add", "--", "existing.ts", "created.ts"]);
  await git(directory, ["commit", "-m", "generated change"]);
  return { directory, baseCommit };
}

describe("GitCliAdapter", () => {
  it("captures real commit metadata and byte hashes", async () => {
    const { directory, baseCommit } = await repositoryFixture();
    const commit = await (await GitCliAdapter.open(directory)).inspectCommit();
    expect(commit.baseCommit).toBe(baseCommit);
    expect(commit.author).toBe("Trace Tester");
    expect(commit.authorEmail).toBe("trace@example.test");
    const modified = commit.changedFiles.find((change) => change.path === "existing.ts");
    const created = commit.changedFiles.find((change) => change.path === "created.ts");
    expect(modified).toMatchObject({
      operation: "MODIFIED",
      beforeHash: sha256("export const value = 1;\n"),
      afterHash: sha256("export const value = 2;\n")
    });
    expect(created).toMatchObject({
      operation: "CREATED", beforeHash: null,
      afterHash: sha256("export const created = true;\n")
    });
    expect(modified?.diffHash).toMatch(/^[a-f0-9]{64}$/u);
  }, 15_000);

  it("classifies artifact-to-commit evidence without overstating partial matches", async () => {
    const { directory } = await repositoryFixture();
    const commit = await (await GitCliAdapter.open(directory)).inspectCommit();
    const createdHash = sha256("export const created = true;\n");
    const confirmed = correlateArtifacts("run-1", [
      { artifactId: "artifact-1", relativePath: "created.ts", contentHash: createdHash }
    ], commit);
    expect(confirmed.evidence).toBe("CONFIRMED");

    const candidate = correlateArtifacts("run-1", [
      { artifactId: "artifact-1", relativePath: "created.ts", contentHash: createdHash },
      { artifactId: "artifact-2", relativePath: "missing.ts", contentHash: "0".repeat(64) }
    ], commit);
    expect(candidate.evidence).toBe("CANDIDATE");
    expect(candidate.unmatchedArtifactIds).toEqual(["artifact-2"]);

    expect(correlateArtifacts("run-1", [], commit).evidence).toBe("UNRESOLVED");
  }, 15_000);

  it("rejects option-like revision input", async () => {
    const { directory } = await repositoryFixture();
    const adapter = await GitCliAdapter.open(directory);
    await expect(adapter.resolveCommit("--upload-pack=evil")).rejects.toMatchObject({ code: "INVALID_COMMIT" });
  }, 15_000);
});
