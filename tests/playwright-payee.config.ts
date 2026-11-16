import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", testMatch: /(?:payee-finance|operating-cfdi-create|operating-cfdi-associate)\.spec\.ts/, workers: 1,
  timeout: 120000, expect: { timeout: 20000 }, reporter: "list",
  use: { ...devices["Desktop Chrome"], headless: true, actionTimeout: 20000, trace: "retain-on-failure" } });
