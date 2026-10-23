import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/traceforge-api/config", () => ({
  loadTraceForgeApiConfig: () => ({
    baseUrl: "http://backend.test",
    token: "private-api-token",
    timeoutMs: 8000
  })
}));
afterEach(() => vi.unstubAllGlobals());

it("validates lookup input before calling the backend", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(
    (await GET(new NextRequest("http://localhost/api/anchor-lookup?sessionHash=wrong"))).status
  ).toBe(400);
  expect((await GET(new NextRequest("http://localhost/api/anchor-lookup"))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps authentication server-side and preserves an empty search result", async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ matches: [] }) }));
  vi.stubGlobal("fetch", fetchMock);
  const response = await GET(
    new NextRequest(`http://localhost/api/anchor-lookup?manifestHash=0x${"a".repeat(64)}`)
  );
  expect(await response.json()).toEqual({ matches: [] });
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/api/v1/verification/anchor-lookup?manifestHash="),
    expect.objectContaining({ headers: { authorization: "Bearer private-api-token" } })
  );
});

it("does not misreport an unavailable or outdated backend as no local record", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404 }))
  );
  const response = await GET(
    new NextRequest(`http://localhost/api/anchor-lookup?sessionHash=0x${"a".repeat(64)}`)
  );
  expect(response.status).toBe(502);
  expect((await response.json()).error).toMatch(/Restart/);
});
