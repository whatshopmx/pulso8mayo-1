import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Los specs comparten la base de desarrollo y se pisan entre sí (SKUs de alto
   * valor, conteos activos por sucursal), así que corren en serie. */
  fullyParallel: false,
  workers: 1,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* El arranque en frío del servidor y las consultas a Neon son lentos. */
  timeout: 120_000,
  expect: { timeout: 20_000 },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',

    actionTimeout: 30_000,
    navigationTimeout: 60_000,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    // Inicia sesión una vez y guarda las cookies para el resto de los specs.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'tests/.auth/admin.json'),
      },
      dependencies: ['setup'],
    },
    // For MVP phase, Chrome is sufficient to measure critical paths.
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /**
   * Servidores bajo prueba. El dev server compila cada ruta al primer golpe,
   * por eso los timeouts de arriba son generosos. Con un build ya hecho
   * (`pnpm build`) conviene correrlos contra producción, que es mucho más
   * rápido y estable:
   *   PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm test:e2e
   * Ojo: `next dev` y `next start` comparten `.next`, así que no pueden
   * convivir — hay que apagar el dev server antes de construir.
   *
   * El Inngest Dev Server es obligatorio en local: desde 8f97d20 los
   * extractores post-completado (conteo, merma, producción, recepción) viajan
   * como evento `workflow/instance.completed`; sin un dev server consumiendo,
   * `inngest.send()` publica y nadie ejecuta → las filas nunca llegan a la BD.
   */
  webServer: [
    {
      command: process.env.PLAYWRIGHT_WEB_SERVER_CMD || 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: { ...process.env, INNGEST_DEV: '1' },
    },
    {
      command:
        'npx inngest-cli@latest dev -u http://localhost:3000/api/inngest',
      url: 'http://localhost:8288',
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
