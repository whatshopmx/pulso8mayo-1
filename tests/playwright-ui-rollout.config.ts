import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "ui-rollout.spec.ts", workers: 1, fullyParallel: false,
  timeout: 120000, expect: { timeout: 30000 }, reporter: "list",
  use: { ...devices["Desktop Chrome"], timezoneId: "America/Mexico_City", headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
});
