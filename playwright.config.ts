// The web UI's smoke test (test/ui): npm run test:ui. It runs against the dev server on PORT, 5173
// by default as for `make dev`, and starts one there if none is running.

import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  testDir: "test/ui",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    timezoneId: "UTC",
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: true,
    stdout: "ignore",
  },
});
