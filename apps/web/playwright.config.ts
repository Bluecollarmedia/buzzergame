import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a real local Supabase stack (`supabase start`)
 * and a production build of the web app. See docs/testing.md.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
