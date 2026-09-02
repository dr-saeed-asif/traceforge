import { describe, expect, it } from "vitest";
import { loadCentralServerConfig } from "../src/config.js";

function environment(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "mysql://example.test/traceforge",
    TRACEFORGE_API_TOKEN: "0123456789abcdef",
    TRACEFORGE_ARTIFACT_DIR: ".traceforge/artifacts",
    TRACEFORGE_LOCAL_KEY_ID: "local-test-key",
    TRACEFORGE_LOCAL_KEK_BASE64: Buffer.alloc(32, 7).toString("base64"),
    ENCRYPTION_PROVIDER: "local"
  };
}

describe("central server configuration", () => {
  it("loads secure defaults and required values", () => {
    const config = loadCentralServerConfig(environment());
    expect(config).toMatchObject({ host: "127.0.0.1", port: 8080, databasePoolSize: 10, maxBodyBytes: 65_536 });
    expect(config.localKek).toHaveLength(32);
  });

  it("rejects invalid key material and short tokens", () => {
    expect(() => loadCentralServerConfig({ ...environment(), TRACEFORGE_API_TOKEN: "short" })).toThrow(/at least 16/u);
    expect(() => loadCentralServerConfig({ ...environment(), TRACEFORGE_LOCAL_KEK_BASE64: "bad" })).toThrow(/32 bytes/u);
  });
});
