import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "pos-file-access.spec.ts", workers: 1, fullyParallel: false,
  timeout: 60000, expect: { timeout: 10000 }, reporter: "list",
  use: { ...devices["Desktop Chrome"], headless: true, trace: "retain-on-failure" },
});
