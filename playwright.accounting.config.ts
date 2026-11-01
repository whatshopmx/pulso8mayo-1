import { defineConfig, devices } from "@playwright/test";

// Component/HTTP harnesses own ephemeral Vite servers and synthetic data.
// They do not require Next, Inngest, authentication fixtures or an operational DB.
export default defineConfig({
  testDir:"./tests/e2e",testMatch:/accounting(?:-journals)?\.spec\.ts/,
  workers:1,fullyParallel:false,timeout:60000,expect:{timeout:15000},reporter:"list",
  use:{...devices["Desktop Chrome"],headless:true,trace:"retain-on-failure"},
});
