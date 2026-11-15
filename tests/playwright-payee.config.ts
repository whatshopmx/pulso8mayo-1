import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", testMatch: "payee-finance.spec.ts", workers: 1,
  timeout: 120000, expect: { timeout: 20000 }, reporter: "list",
  use: { ...devices["Desktop Chrome"], headless: true, trace: "retain-on-failure" } });
