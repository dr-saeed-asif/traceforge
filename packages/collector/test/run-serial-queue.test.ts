import { describe, expect, it } from "vitest";
import { RunSerialQueue } from "../src/index.js";

describe("RunSerialQueue", () => {
  it("applies bounded backpressure", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queue = new RunSerialQueue(1);
    const active = queue.enqueue("run-1", () => gate);
    expect(() => queue.enqueue("run-2", async () => undefined)).toThrow(/capacity/u);
    release?.();
    await active;
    await queue.shutdown();
  });
});
