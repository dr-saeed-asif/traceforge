import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

describe("web health endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("TRACEFORGE_API_URL", "http://traceforge.test");
    vi.stubEnv("TRACEFORGE_API_TOKEN", "test-token-with-enough-length");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ok",
            checks: {
              backend: true,
              llm: true,
              extraction: true,
              database: true,
              extractor: "test-extractor"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns aggregated readiness without exposing configuration details", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      checks: {
        frontend: true,
        backend: true,
        llm: true,
        extraction: true,
        database: true,
        extractor: "test-extractor"
      }
    });
    expect(JSON.stringify(body)).not.toContain("test-token");
  });
});
