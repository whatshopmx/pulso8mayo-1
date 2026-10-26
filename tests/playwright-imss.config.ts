import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
    testDir: './e2e', testMatch: 'imss-ui.spec.ts', workers: 1, timeout: 120_000, expect: { timeout: 15_000 }, reporter: 'list',
    use: { ...devices['Desktop Chrome'], timezoneId: 'America/Mexico_City', actionTimeout: 15_000, navigationTimeout: 30_000, screenshot: 'only-on-failure' },
});
