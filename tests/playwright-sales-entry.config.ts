import { defineConfig, devices } from "@playwright/test";

// Servidor efímero del componente; fixtures HTTP explícitas, sin Next/Inngest ni DB operativa.
export default defineConfig({
  testDir: "./e2e", testMatch: ["sales-entry-feedback.spec.ts", "pos-workflow-feedback.spec.ts"], workers: 1, fullyParallel: false,
  timeout: 60000, expect: { timeout: 15000 }, reporter: "list",
  use: { ...devices["Desktop Chrome"], timezoneId: "America/Mexico_City", headless: true, trace: "retain-on-failure" },
});
