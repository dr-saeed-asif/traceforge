import { describe, expect, it } from "vitest";
import { parseSessionDateRange } from "./date-range";

describe("parseSessionDateRange", () => {
  it("keeps the selected final day inclusive by querying the next UTC midnight", () => {
    expect(parseSessionDateRange({ from: "2026-09-01", to: "2026-09-21" })).toEqual({
      values: { from: "2026-09-01", to: "2026-09-21" },
      query: {
        startedAfter: "2026-09-01T00:00:00.000Z",
        startedBefore: "2026-09-22T00:00:00.000Z"
      },
      error: null
    });
  });

  it("rejects impossible and inverted dates", () => {
    expect(parseSessionDateRange({ from: "2026-02-30" }).error).toMatch(/valid/u);
    expect(parseSessionDateRange({ from: "2026-09-22", to: "2026-09-21" }).error).toMatch(
      /start date/u
    );
  });
});
