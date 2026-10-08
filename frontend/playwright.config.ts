import { defineConfig, devices } from "@playwright/test";

const outputDir = process.env["DAP_KUMO_TEST_OUTPUT"] || process.env["RUNNER_TEMP"];
if (!outputDir) throw new Error("Set DAP_KUMO_TEST_OUTPUT to an issue-specific test output directory.");

const baseURL = process.env["DAP_KUMO_BASE_URL"] || "http://127.0.0.1:4178";
const serverPort = new URL(baseURL).port || "4178";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  workers: process.env["CI"] ? 2 : undefined,
  reporter: "list",
  outputDir,
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], browserName: "webkit" },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${serverPort} --strictPort`,
    url: `${baseURL}/__kumo-spike`,
    // Never silently attach to another worktree's dev server on the default port.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
