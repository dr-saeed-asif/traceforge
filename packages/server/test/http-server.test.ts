import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { close, createTraceForgeHttpServer } from "../src/http-server.js";

const servers: ReturnType<typeof createTraceForgeHttpServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => close(server))); });

describe("central HTTP adapter", () => {
  it("serves an unauthenticated health endpoint", async () => {
    const server = createTraceForgeHttpServer({ handle: async () => new Response("unexpected", { status: 500 }) }, { host: "127.0.0.1", port: 0, maxBodyBytes: 1024 });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("forwards method, authorization, and JSON body to the framework-neutral API", async () => {
    const server = createTraceForgeHttpServer({ handle: async (request) => Response.json({ method: request.method, token: request.headers.get("authorization"), body: await request.json() }) }, { host: "127.0.0.1", port: 0, maxBodyBytes: 1024 });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/integrations/events`, { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify({ value: 1 }) });
    await expect(response.json()).resolves.toEqual({ method: "POST", token: "Bearer token", body: { value: 1 } });
  });
});
