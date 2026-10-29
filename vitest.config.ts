import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The web workspace has its own jsdom configuration and quality command.
    exclude: [...configDefaults.exclude, "apps/web/**", ".traceforge/**", "research/**"]
  }
});
