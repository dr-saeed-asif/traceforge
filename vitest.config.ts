import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@traceforge/anchor": fileURLToPath(new URL("./packages/anchor/src/index.ts", import.meta.url)),
      "@traceforge/adapter-contracts": fileURLToPath(new URL("./packages/adapter-contracts/src/index.ts", import.meta.url)),
      "@traceforge/adapter-opencode": fileURLToPath(new URL("./packages/adapter-opencode/src/index.ts", import.meta.url)),
      "@traceforge/adapter-ollama": fileURLToPath(new URL("./packages/adapter-ollama/src/index.ts", import.meta.url)),
      "@traceforge/adapter-model-gateways": fileURLToPath(new URL("./packages/adapter-model-gateways/src/index.ts", import.meta.url)),
      "@traceforge/api": fileURLToPath(new URL("./packages/api/src/index.ts", import.meta.url)),
      "@traceforge/application": fileURLToPath(new URL("./packages/application/src/index.ts", import.meta.url)),
      "@traceforge/collector": fileURLToPath(new URL("./packages/collector/src/index.ts", import.meta.url)),
      "@traceforge/crypto": fileURLToPath(new URL("./packages/crypto/src/index.ts", import.meta.url)),
      "@traceforge/database": fileURLToPath(new URL("./packages/database/src/index.ts", import.meta.url)),
      "@traceforge/domain": fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url)),
      "@traceforge/git": fileURLToPath(new URL("./packages/git/src/index.ts", import.meta.url)),
      "@traceforge/provenance": fileURLToPath(new URL("./packages/provenance/src/index.ts", import.meta.url)),
      "@traceforge/sdk": fileURLToPath(new URL("./packages/sdk/src/index.ts", import.meta.url))
      ,"@traceforge/server": fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url))
    }
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    coverage: { provider: "v8" }
  }
});
