import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.mjs",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.SITE_URL || "http://127.0.0.1:48317/github-learn-link-generator/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: process.env.SITE_URL ? undefined : {
    command: "node tests/serve.mjs",
    url: "http://127.0.0.1:48317/github-learn-link-generator/",
    reuseExistingServer: false,
  },
});
