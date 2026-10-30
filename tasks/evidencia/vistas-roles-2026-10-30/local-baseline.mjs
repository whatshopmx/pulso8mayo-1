// RP-00: navegador local en contextos independientes; solo login y lecturas.
// NODE_OPTIONS=--use-system-ca; requiere Next ya disponible en localhost:3000.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const evidenceDirectory = fileURLToPath(new URL('.', import.meta.url));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const user of ['juan', 'ana', 'pedro']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const record = { user, views: [], errors };
      try {
        await page.goto('http://localhost:3000/sign-in', { timeout: 120000 });
        await page.getByLabel('Correo Electrónico').fill(`${user}@pulso.mx`);
        // Credencial del fixture demo existente; no se ejecuta seed-passwords.
        await page.getByLabel('Contraseña', { exact: true }).fill('123456');
        await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click();
        await page.waitForURL('**/dashboard', { timeout: 120000 });
        for (const route of ['/dashboard', '/dashboard/schedules', '/dashboard/employees', '/dashboard/executive']) {
          const response = await page.goto(`http://localhost:3000${route}`, { timeout: 120000 });
          const body = await page.locator('body').innerText({ timeout: 60000 });
          record.views.push({ route, status: response?.status(), url: page.url(),
            text: body.slice(0, 9000), genericError: /Algo salió mal|Application error|Maximum update depth/i.test(body) });
        }
      } catch (e) { record.failure = e.message; }
      finally { await context.close(); }
      results.push(record);
      console.log(`${user}: ${record.views.length} vistas; ${record.failure ? 'fallo' : 'recorrido completo'}`);
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(evidenceDirectory, 'local-baseline.json'), JSON.stringify({ environment: 'localhost:3000', capturedAt: new Date().toISOString(), results }, null, 2));
  }
  if (results.some(r => r.failure)) process.exitCode = 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });
