import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import type { GitCommit, GitFileChange, FileOperation } from "@traceforge/domain";
import { sha256 } from "@traceforge/crypto";
import { GitProvenanceError } from "./errors/git-error.js";

interface NameStatus { readonly operation: FileOperation; readonly path: string; readonly previousPath?: string }

export class GitCliAdapter {
  private constructor(private readonly repositoryPath: string) {}

  public static async open(repositoryPath: string): Promise<GitCliAdapter> {
    const resolved = await realpath(repositoryPath);
    const adapter = new GitCliAdapter(resolved);
    const topLevel = (await adapter.text(["rev-parse", "--show-toplevel"])).trim();
    if (await realpath(topLevel) !== resolved) {
      throw new GitProvenanceError("INVALID_OUTPUT", "Repository path must be the Git worktree root");
    }
    return adapter;
  }

  public async resolveCommit(reference = "HEAD"): Promise<string> {
    if (reference.startsWith("-")) throw new GitProvenanceError("INVALID_COMMIT", "Commit reference cannot be an option");
    const commitId = (await this.text(["rev-parse", "--verify", `${reference}^{commit}`])).trim();
    if (!/^[a-f0-9]{40,64}$/u.test(commitId)) throw new GitProvenanceError("INVALID_OUTPUT", "Git returned an invalid commit ID");
    return commitId;
  }

  public async inspectCommit(reference = "HEAD"): Promise<GitCommit> {
    const commitId = await this.resolveCommit(reference);
    const fields = (await this.text(["show", "-s", "--format=%H%x00%P%x00%an%x00%ae%x00%aI", commitId])).trimEnd().split("\0");
    if (fields.length !== 5) throw new GitProvenanceError("INVALID_OUTPUT", "Unexpected Git commit metadata");
    const [observedCommit, parents, author, authorEmail, timestamp] = fields as [string, string, string, string, string];
    const baseCommit = parents.split(" ").filter(Boolean)[0] ?? null;
    const branch = await this.branchFor(commitId);
    const statuses = await this.changedPaths(commitId);
    const changedFiles: GitFileChange[] = [];
    for (const status of statuses) changedFiles.push(await this.fileChange(commitId, baseCommit, status));
    return {
      repository: this.repositoryPath, branch, baseCommit, commitId: observedCommit,
      author, authorEmail, timestamp, changedFiles
    };
  }

  private async changedPaths(commitId: string): Promise<readonly NameStatus[]> {
    const output = await this.run(["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", "-z", commitId]);
    const fields = output.toString("utf8").split("\0").filter((value) => value !== "");
    const results: NameStatus[] = [];
    for (let index = 0; index < fields.length;) {
      const status = fields[index++];
      if (status === undefined) break;
      const code = status[0];
      if (code === "R") {
        const previousPath = fields[index++];
        const path = fields[index++];
        if (previousPath === undefined || path === undefined) throw new GitProvenanceError("INVALID_OUTPUT", "Incomplete rename record");
        results.push({ operation: "RENAMED", previousPath, path });
      } else {
        const path = fields[index++];
        if (path === undefined) throw new GitProvenanceError("INVALID_OUTPUT", "Incomplete file-change record");
        const operation = code === "A" ? "CREATED" : code === "D" ? "DELETED" : "MODIFIED";
        results.push({ operation, path });
      }
    }
    return results;
  }

  private async fileChange(commitId: string, baseCommit: string | null, status: NameStatus): Promise<GitFileChange> {
    const beforePath = status.previousPath ?? status.path;
    const before = baseCommit === null || status.operation === "CREATED"
      ? null : await this.blob(baseCommit, beforePath);
    const after = status.operation === "DELETED" ? null : await this.blob(commitId, status.path);
    const diffArguments = baseCommit === null
      ? ["show", "--format=", "--binary", commitId, "--", beforePath, status.path]
      : ["diff", "--binary", baseCommit, commitId, "--", beforePath, status.path];
    return {
      path: status.path,
      ...(status.previousPath === undefined ? {} : { previousPath: status.previousPath }),
      operation: status.operation,
      beforeHash: before === null ? null : sha256(before),
      afterHash: after === null ? null : sha256(after),
      diffHash: sha256(await this.run(diffArguments))
    };
  }

  private async blob(commitId: string, path: string): Promise<Buffer> {
    return this.run(["show", `${commitId}:${path}`]);
  }

  private async branchFor(commitId: string): Promise<string | null> {
    const head = await this.resolveCommit("HEAD");
    if (head !== commitId) return null;
    const branch = (await this.text(["branch", "--show-current"])).trim();
    return branch === "" ? null : branch;
  }

  private text(args: readonly string[]): Promise<string> {
    return this.run(args).then((output) => output.toString("utf8"));
  }

  private run(args: readonly string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      execFile("git", ["-C", this.repositoryPath, ...args], {
        encoding: "buffer", maxBuffer: 32 * 1024 * 1024, windowsHide: true
      }, (error, stdout, stderr) => {
        if (error !== null) {
          reject(new GitProvenanceError("GIT_COMMAND_FAILED", Buffer.from(stderr).toString("utf8").trim() || error.message, { cause: error }));
          return;
        }
        resolve(Buffer.from(stdout));
      });
    });
  }
}
