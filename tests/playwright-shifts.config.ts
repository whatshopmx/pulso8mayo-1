import { defineConfig, devices } from "@playwright/test";

/** Pruebas de UI aisladas: no arrancan Next/Inngest ni usan la base compartida. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["shifts-export.spec.ts", "shifts-template.spec.ts", "shifts-bulk.spec.ts", "operating-config.spec.ts"],
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: { ...devices["Desktop Chrome"], timezoneId: "America/Mexico_City" },
});
