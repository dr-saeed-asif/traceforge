import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("domain dependency boundary", () => {
  it("does not import providers, infrastructure, frameworks, or Node APIs", () => {
    const source = join(dirname(fileURLToPath(import.meta.url)), "../src");
    const forbidden = [
      "openai", "anthropic", "ollama", "deepseek", "opencode",
      "mysql", "fastify", "express", "react", "node:"
    ];
    const imports = sourceFiles(source)
      .flatMap((file) => readFileSync(file, "utf8").match(/from\s+["'][^"']+["']/gu) ?? [])
      .join("\n")
      .toLowerCase();
    for (const dependency of forbidden) expect(imports).not.toContain(dependency);
  });
});
