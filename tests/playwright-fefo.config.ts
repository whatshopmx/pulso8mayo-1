import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e', testMatch: 'fefo-status.spec.ts', workers: 1,
    timeout: 120_000, expect: { timeout: 15_000 }, reporter: 'list', maxFailures: 1,
    use: { ...devices['Desktop Chrome'], timezoneId: 'America/Mexico_City',
        actionTimeout: 15_000, screenshot: 'only-on-failure' },
});
