import { and, eq } from 'drizzle-orm';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect } from 'vitest';
import { workflowTemplates } from '@/lib/db/schema';
import { templateLibrary } from '@/templates';
import type { createSalesRuntimeDatabase } from './sales-runtime-database';
import { seedCsvRuntimeScenario } from './csv-runtime-scenario';
import { startSalesRuntimeNextServer } from './sales-runtime-next-server';

/** Clones and edits a library template through Next; never launches its completion actions. */
export async function verifyPosTemplateInstallation(database: Awaited<ReturnType<typeof createSalesRuntimeDatabase>>) {
  const scenario = await seedCsvRuntimeScenario(database);
  let server: Awaited<ReturnType<typeof startSalesRuntimeNextServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    server = await startSalesRuntimeNextServer(database);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ baseURL: server.baseURL, timezoneId: 'America/Mexico_City' });
    try {
      expect((await context.request.post('/api/auth/sign-in/email', { headers: { origin: server.baseURL },
        data: { email: `${scenario.actorId}@example.invalid`, password: scenario.password } })).status()).toBe(200);
      await context.addCookies([{ name: 'pulso_selected_branch', value: scenario.branchId, url: server.baseURL }]);
      const page = await context.newPage(), errors: string[] = [];
      const updates: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (request.method() === 'PATCH' && new URL(request.url()).pathname.startsWith('/api/templates/')) {
          updates.push(String(request.postDataJSON()?.name));
        }
      });
      await page.goto('/dashboard/builder/templates', { timeout: 90_000 });
      await page.getByRole('tab', { name: 'Catálogo Pulso', exact: true }).click();
      const card = page.locator('[data-slot="card"]').filter({ hasText: templateLibrary['cierre-sucursal-v2'].title });
      await browserExpect(card).toHaveCount(1);
      const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workflows/templates'
        && response.request().method() === 'POST', { timeout: 90_000 });
      await card.getByRole('button', { name: 'Usar Plantilla', exact: true }).click();
      const response = await created;
      expect(response.status()).toBe(200);
      const templateId: string = (await response.json()).data.id;
      await browserExpect(page).toHaveURL(new RegExp(`/dashboard/builder/editor/${templateId}$`), { timeout: 90_000 });
      const stored = async () => {
        const [template] = await database.owner.select({ name: workflowTemplates.name, steps: workflowTemplates.steps })
          .from(workflowTemplates).where(and(eq(workflowTemplates.id, templateId), eq(workflowTemplates.companyId, scenario.companyId)));
        expect(template).toBeDefined();
        const steps = template.steps as { id: string; config?: { posUpload?: boolean }; description?: string }[];
        expect(steps).toHaveLength(templateLibrary['cierre-sucursal-v2'].steps.length);
        expect(steps.filter(step => step.config?.posUpload).map(step => step.id)).toEqual(['paso-upload-pos']);
        expect(steps.find(step => step.id === 'paso-upload-pos')?.description).toContain('revisa el resultado');
        return template;
      };
      await stored();
      const title = page.getByPlaceholder('Nombre de la Plantilla', { exact: true });
      await browserExpect(title).toBeVisible();
      // A visible SSR input alone does not prove hydration. Exercise a client
      // handler before editing, so hydration cannot replace a pre-React fill.
      await page.getByRole('button', { name: 'Vista Previa', exact: true }).click();
      await browserExpect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await browserExpect(page.getByRole('dialog')).toBeHidden();
      const renamed = 'Cierre POS sintético instalado y editado';
      try {
        const [saved] = await Promise.all([
          page.waitForResponse(received => new URL(received.url()).pathname === `/api/templates/${templateId}`
            && received.request().method() === 'PATCH' && received.request().postDataJSON()?.name === renamed, { timeout: 90_000 }),
          (async () => {
            await title.fill(renamed);
            await browserExpect(title).toHaveValue(renamed);
            await browserExpect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled();
            await page.keyboard.press('Control+s');
          })(),
        ]);
        expect(saved.status()).toBe(200);
      } catch (failure) {
        console.info('Synthetic POS template editor diagnostic', { title: await title.inputValue(), updates, errors });
        await page.screenshot({ path: '.tmp/pos-template-next-failure.png', fullPage: true });
        throw failure;
      }
      expect((await stored()).name).toBe(renamed);
      await page.reload({ timeout: 90_000 });
      await browserExpect(page.getByPlaceholder('Nombre de la Plantilla', { exact: true })).toHaveValue(renamed);
      await stored();
      expect(errors).toEqual([]);
      expect((await scenario.state()).identities).toEqual([]);
      expect((await scenario.state()).movements).toEqual([]);
    } finally { await context.close(); }
  } finally {
    try { await browser?.close(); }
    finally { await server?.close(); }
  }
}
