import { defineConfig, devices } from "@playwright/test";

/** Componente real y API simulada; no inicia Next, Inngest, DB ni timbradores. */
export default defineConfig({
  testDir: "./e2e", testMatch: "aguinaldo-payment.spec.ts", workers: 1, timeout: 120_000,
  expect: { timeout: 15_000 }, reporter: "list",
  use: { ...devices["Desktop Chrome"], timezoneId: "America/Mexico_City" },
});
