import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/globalSetup.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    // Tests share one database; run files one at a time.
    fileParallelism: false,
  },
});
