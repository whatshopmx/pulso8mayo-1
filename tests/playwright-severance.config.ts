import { defineConfig, devices } from "@playwright/test";

/** Pantalla real con sesión/API simuladas. Nunca arranca Next, Inngest ni Postgres. */
export default defineConfig({
  testDir: "./e2e", testMatch: "severance-minimum-wage.spec.ts",
  workers: 1, timeout: 120_000, expect: { timeout: 15_000 }, reporter: "list",
  use: { ...devices["Desktop Chrome"], timezoneId: "America/Mexico_City" },
});
