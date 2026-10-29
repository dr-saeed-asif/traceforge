import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createTraceForgeApiClient } from "./client";
import { loadTraceForgeApiConfig } from "./config";
import { TraceForgeApiError } from "./errors";

const config = {
  baseUrl: "http://127.0.0.1:8080",
  token: "server-secret-token",
  timeoutMs: 50
};

const session = {
  promptId: "prompt-1",
  promptQuery: "Create the requested file",
  externalSessionId: "session-1",
  runId: "run-1",
  projectName: null,
  projectPath: null,
  agentName: "builder",
  modelName: "test-model",
  executionStatus: "COMPLETED",
  extractionStatus: "SUCCEEDED",
  verificationStatus: "SUCCEEDED",
  totalClaims: 0,
  verifiedClaims: 0,
  contradictedClaims: 0,
  unsupportedClaims: 0,
  unverifiableClaims: 0,
  scoredClaims: 0,
  reliabilityPercent: null,
  coveragePercent: null,
  startedAt: "2026-09-21T10:00:00.000Z",
  completedAt: "2026-09-21T10:00:01.000Z"
};

const sessionsResponse = {
  sessions: [session],
  pagination: { limit: 11, offset: 20, returned: 1 }
};

afterEach(() => {
  vi.useRealTimers();
});

describe("TraceForge server API client", () => {
  it("sends the bearer token server-side and validates a successful response", async () => {
    const fetchImplementation = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse(sessionsResponse));
    const client = createTraceForgeApiClient({
      config,
      fetchImplementation: fetchImplementation as unknown as typeof fetch
    });

    const response = await client.getSessions({ limit: 10, offset: 20 });

    expect(response.sessions).toHaveLength(1);
    const [url, request] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      "http://127.0.0.1:8080/api/v1/verification/sessions?limit=11&offset=20"
    );
    expect(request?.headers).toMatchObject({
      accept: "application/json",
      authorization: "Bearer server-secret-token"
    });
    expect(request?.cache).toBe("no-store");
  });

  it("maps upstream HTTP errors without exposing credentials", async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401));
    const client = createTraceForgeApiClient({
      config,
      fetchImplementation: fetchImplementation as unknown as typeof fetch
    });

    await expect(client.getSessions()).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 401,
      upstreamCode: "unauthorized"
    });
    await expect(client.getSessions()).rejects.not.toThrow("server-secret-token");
  });

  it("rejects malformed successful responses and unsafe query values", async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({ sessions: {} }));
    const client = createTraceForgeApiClient({
      config,
      fetchImplementation: fetchImplementation as unknown as typeof fetch
    });

    await expect(client.getSessions()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(client.getSessions({ limit: 101 })).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("aborts requests at the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn(
      (_url: URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    const client = createTraceForgeApiClient({
      config: { ...config, timeoutMs: 25 },
      fetchImplementation: fetchImplementation as unknown as typeof fetch
    });

    const request = client.getSessions();
    const expectation = expect(request).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(25);
    await expectation;
  });

  it("requires server-only environment variables", () => {
    expect(() =>
      loadTraceForgeApiConfig({ NEXT_PUBLIC_TRACEFORGE_API_TOKEN: "public-token" })
    ).toThrow(TraceForgeApiError);
    expect(
      loadTraceForgeApiConfig({
        TRACEFORGE_API_URL: "https://traceforge.example.test/",
        TRACEFORGE_API_TOKEN: "private-token-value",
        TRACEFORGE_API_TIMEOUT_MS: "1200"
      })
    ).toEqual({
      baseUrl: "https://traceforge.example.test",
      token: "private-token-value",
      timeoutMs: 1200
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
