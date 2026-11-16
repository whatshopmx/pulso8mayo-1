import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'leave-review.spec.ts', workers: 1, fullyParallel: false,
  // Match the main project's budget: a cold Vite module graph is expensive on Windows.
  timeout: 120000, expect: { timeout: 20000 }, reporter: 'list',
  use: { ...devices['Desktop Chrome'], timezoneId: 'America/Mexico_City', headless: true, trace: 'retain-on-failure' },
});
