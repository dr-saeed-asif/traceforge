import { describe, expect, it } from "vitest";
import { parseSessionListQuery, sessionListHref } from "./session-list-query";

describe("session list URL state", () => {
  it("converts page and inclusive dates into an API query", () => {
    expect(parseSessionListQuery({ page: "3", from: "2026-09-01", to: "2026-09-21" })).toEqual({
      values: { from: "2026-09-01", to: "2026-09-21" },
      page: 3,
      query: {
        startedAfter: "2026-09-01T00:00:00.000Z",
        startedBefore: "2026-09-22T00:00:00.000Z",
        limit: 10,
        offset: 20
      },
      error: null
    });
  });

  it("rejects unsafe pages and preserves filters in links", () => {
    expect(parseSessionListQuery({ page: "0" }).error).toMatch(/page number/u);
    expect(parseSessionListQuery({ page: "abc" }).error).toMatch(/page number/u);
    expect(sessionListHref({ from: "2026-09-01", to: "2026-09-21" }, 2)).toBe(
      "/sessions?from=2026-09-01&to=2026-09-21&page=2"
    );
  });
});
