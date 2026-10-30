import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.ROLES_BASE_URL ?? 'http://localhost:3100';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseURL)) throw new Error('Solo localhost para esta verificación.');
const condesa = 'b1000001-0000-4000-8000-000000000001';
const polanco = 'b1000001-0000-4000-8000-000000000002';
const cases = [
  { user: 'juan', label: 'Condesa', fixed: true },
  { user: 'ana', label: 'Polanco', fixed: true },
  { user: 'pedro', label: 'Condesa', fixed: true },
  { user: 'diana', label: 'Condesa', fixed: true },
  { user: 'carlos', label: 'Polanco', fixed: false },
];
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const testCase of cases) {
    const context = await browser.newContext();
    // Preferencias manipuladas, nunca cookies de autenticación.
    await context.addCookies([{ name: 'pulso_selected_branch', value: testCase.user === 'ana' ? condesa : polanco, url: baseURL }]);
    const page = await context.newPage();
    const result = { user: testCase.user, errors: [], expectedScope: testCase.label, passed: false };
    page.on('pageerror', error => result.errors.push(error.message));
    try {
      await page.goto(`${baseURL}/sign-in`, { timeout: 120000 });
      await page.getByLabel('Correo Electrónico').fill(`${testCase.user}@pulso.mx`);
      await page.getByLabel('Contraseña', { exact: true }).fill('123456');
      await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click();
      await page.waitForURL('**/dashboard', { timeout: 120000 });
      if (testCase.fixed) await page.goto(`${baseURL}/dashboard?branch=${testCase.user === 'ana' ? condesa : polanco}`, { timeout: 120000 });
      await expect(page.getByText(`Sucursal: ${testCase.label}`, { exact: true }).first()).toBeVisible({ timeout: 60000 });
      if (testCase.fixed) await expect(page.getByText('Tu usuario está asignado a esta sucursal.', { exact: true })).toBeVisible();
      // Ventana explícita para detectar ciclos posteriores a la hidratación.
      await page.waitForTimeout(3000);
      expect(result.errors).toEqual([]);
      await page.screenshot({ path: fileURLToPath(new URL(`scope-${testCase.user}.png`, import.meta.url)), fullPage: false });
      result.passed = true;
    } catch (error) { result.failure = error.message; }
    finally { await context.close(); }
    results.push(result);
    console.log(`${testCase.user}: ${result.passed ? 'scope verificado' : 'falló'}`);
  }
} finally {
  await browser.close();
  fs.writeFileSync(fileURLToPath(new URL('rp02-runtime.json', import.meta.url)), JSON.stringify({ baseURL, capturedAt: new Date().toISOString(), results }, null, 2));
}
if (results.some(result => !result.passed)) process.exitCode = 1;
