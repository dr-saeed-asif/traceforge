import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/index.js";

describe("canonicalize", () => {
  it("sorts object keys recursively without changing array order", () => {
    expect(canonicalize({ z: 1, a: { d: true, c: [3, 2, 1] } })).toBe(
      '{"a":{"c":[3,2,1],"d":true},"z":1}'
    );
  });

  it("rejects values that cannot be represented deterministically", () => {
    expect(() => canonicalize({ value: Number.NaN })).toThrow("Non-finite number");
    expect(() => canonicalize({ value: undefined } as never)).toThrow("Unsupported undefined");
  });
});
