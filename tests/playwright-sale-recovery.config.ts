import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "sale-recovery-create.spec.ts", workers: 1,
  timeout: 60000, expect: { timeout: 10000 }, reporter: "list",
  use: { ...devices["Desktop Chrome"], headless: true, actionTimeout: 10000, screenshot: "only-on-failure" },
});
