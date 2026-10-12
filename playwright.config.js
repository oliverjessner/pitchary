import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.js",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/browser-report", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3217",
    timezoneId: "Europe/Vienna",
    locale: "de-AT",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "artifacts/test-results",
  webServer: [
    {
      command: "node tests/e2e/server.js 3217",
      url: "http://127.0.0.1:3217/api/health",
      reuseExistingServer: false,
    },
    {
      command: "node tests/e2e/server.js 3218",
      url: "http://127.0.0.1:3218/api/health",
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
