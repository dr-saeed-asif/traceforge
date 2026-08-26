import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock, IdGenerator } from "@traceforge/application";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAnchorAdapter } from "../src/index.js";

class FixedClock implements Clock { public now() { return new Date("2026-08-22T12:00:00.000Z"); } }
class Ids implements IdGenerator { private id = 0; public generate() { this.id += 1; return `anchor-${this.id}`; } }
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("LocalAnchorAdapter", () => {
  it("anchors only roots and chains signed receipts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "traceforge-anchor-"));
    directories.push(directory);
    const ledger = join(directory, "anchors.jsonl");
    const anchor = new LocalAnchorAdapter(ledger, new Uint8Array(32).fill(6), new FixedClock(), new Ids());
    const first = await anchor.anchor("a".repeat(64));
    const second = await anchor.anchor("b".repeat(64));
    expect(await anchor.verify(first.rootHash, first)).toBe(true);
    expect(second.previousReceiptHash).toBe(first.receiptHash);
    const stored = await readFile(ledger, "utf8");
    expect(stored).not.toContain("prompt");
    expect(stored).not.toContain("source code");
  });

  it("rejects receipt and ledger tampering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "traceforge-anchor-"));
    directories.push(directory);
    const ledger = join(directory, "anchors.jsonl");
    const anchor = new LocalAnchorAdapter(ledger, new Uint8Array(32).fill(8), new FixedClock(), new Ids());
    const receipt = await anchor.anchor("c".repeat(64));
    expect(await anchor.verify("d".repeat(64), receipt)).toBe(false);
    const stored = await readFile(ledger, "utf8");
    await writeFile(ledger, stored.replace(`"rootHash":"${"c".repeat(64)}"`, `"rootHash":"${"d".repeat(64)}"`), "utf8");
    await expect(anchor.anchor("e".repeat(64))).rejects.toThrow("ledger integrity");
  });
});
