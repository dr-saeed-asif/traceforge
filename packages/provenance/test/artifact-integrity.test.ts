import { describe, expect, it } from "vitest";
import {
  calculateManifestHash,
  createArtifactIntegrity,
  verifyArtifact
} from "../src/index.js";

const encoder = new TextEncoder();

describe("artifact integrity", () => {
  it("fails after one byte changes", () => {
    const original = encoder.encode("export const answer = 42;\n");
    const changed = original.slice();
    changed[0] = (changed[0] ?? 0) ^ 1;
    const record = createArtifactIntegrity(original, "2026-01-01T00:00:00.000Z");

    expect(verifyArtifact(original, record).valid).toBe(true);
    expect(verifyArtifact(changed, record).valid).toBe(false);
  });

  it("produces the same manifest hash regardless of input ordering", () => {
    const entries = [
      { artifactId: "b", relativePath: "src/b.ts", hash: "2".repeat(64), size: 2 },
      { artifactId: "a", relativePath: "src/a.ts", hash: "1".repeat(64), size: 1 }
    ];
    expect(calculateManifestHash(entries)).toBe(calculateManifestHash([...entries].reverse()));
  });
});
