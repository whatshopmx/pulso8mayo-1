import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect } from 'vitest';
import { dailySalesCuts } from '@/lib/db/schema';
import type { createSalesRuntimeDatabase } from './sales-runtime-database';
import { startSalesRuntimeNextServer } from './sales-runtime-next-server';
import { seedCsvRuntimeScenario } from './csv-runtime-scenario';
import { seedPosWorkflow } from './pos-workflow-fixture';

export async function verifyPosRuntimeScenario(database: Awaited<ReturnType<typeof createSalesRuntimeDatabase>>, executor: 'stepper' | 'alternate' = 'stepper') {
  config({ path: '.env', quiet: true }); // Completes R2 credentials; does not override test DATABASE_URL.
  const r2 = await import('@/lib/storage/r2-client');
  expect(r2.isR2Configured(), 'POS runtime verification requires real R2').toBe(true);
  const scenario = await seedCsvRuntimeScenario(database), cutId = randomUUID(), day = '2026-11-21';
  const prefix = `companies/${scenario.companyId}/branches/${scenario.branchId}/pos/${day}/`;
  const storage = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
  const bucket = process.env.R2_BUCKET_NAME || 'pulso-documents';
  const list = () => storage.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  let server: Awaited<ReturnType<typeof startSalesRuntimeNextServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await database.owner.insert(dailySalesCuts).values({ id: cutId, companyId: scenario.companyId, branchId: scenario.branchId,
      businessDate: day, shift: 'COMPLETO', channel: 'TOTAL', totalSales: 0, source: 'MANUAL_FORM', status: 'VALIDATED' });
    const workflow = await seedPosWorkflow(database, scenario);
    server = await startSalesRuntimeNextServer(database);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ baseURL: server.baseURL, timezoneId: 'America/Mexico_City', viewport: { width: 1440, height: 1000 } });
    try {
      expect((await context.request.post('/api/auth/sign-in/email', { headers: { origin: server.baseURL },
        data: { email: `${scenario.actorId}@example.invalid`, password: scenario.password } })).status()).toBe(200);
      await context.addCookies([{ name: 'pulso_selected_branch', value: scenario.branchId, url: server.baseURL }]);
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', failure => errors.push(failure.message));
      if (executor === 'alternate') {
        const [loaded] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === `/api/workflows/executions/${workflow.instanceId}`
            && response.request().method() === 'GET', { timeout: 90_000 }),
          page.goto(`/dashboard/workflows/execute/${workflow.instanceId}`, { timeout: 90_000 }),
        ]);
        expect(loaded.status()).toBe(200);
        const execution = await loaded.json();
        expect(execution).toMatchObject({ id: workflow.instanceId, branchId: scenario.branchId });
        expect(execution.template.steps.find((step: { id: string }) => step.id === 'pos')?.config?.posUpload).toBe(true);
      } else await page.goto(`/dashboard/workflows/${workflow.instanceId}/execute`, { timeout: 90_000 });
      await browserExpect(page.getByLabel('Día del corte', { exact: true })).not.toHaveValue(''); // Client effect proves hydration.
      const mapping = { recipeRef: 'Producto', quantitySold: 'Cantidad', productKey: 'SKU', totalRevenue: 'Ingreso' };
      const csv = (quantity: number, revenue = '') => `SKU,Producto,Cantidad,Ingreso\nPOS-01,"${scenario.recipeNames[0]}",${quantity},${revenue}`;
      const upload = async (quantity: number, revenue: string, name: string, expected: object) => {
        const bytes = Buffer.from(csv(quantity, revenue));
        await page.getByLabel('Archivo del POS', { exact: true }).setInputFiles({ name, mimeType: 'text/csv', buffer: bytes });
        await browserExpect(page.getByLabel('Clave del producto', { exact: true })).toHaveValue('SKU');
        await page.getByLabel('Día del corte', { exact: true }).fill(day);
        await browserExpect(page.getByRole('region', { name: 'Resultado del archivo POS', exact: true })).toHaveCount(0);
        const received = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workflows/smart-links/upload-pos' && response.request().method() === 'POST', { timeout: 90_000 });
        await page.getByRole('button', { name: 'Guardar archivo POS', exact: true }).click();
        const response = await received;
        expect(response.status()).toBe(200);
        const body = (await response.json()).data;
        expect(body).toMatchObject({ durable: true, matchedCount: 1, sales: expected });
        const result = page.getByRole('region', { name: 'Resultado del archivo POS', exact: true });
        await browserExpect(result).toBeVisible();
        await browserExpect(result).toContainText(`${body.sales.inserted} nuevas · ${body.sales.updated} corregidas · ${body.sales.skipped} sin cambios`);
        await browserExpect(result).toContainText(body.sales.revenueComplete ? 'Ingreso completo' : 'Ingreso incompleto');
        for (const failure of body.sales.errors) await browserExpect(result).toContainText(`Fila ${failure.rowNumber}: ${failure.message}`);
        expect(body.fileUrl.startsWith(prefix)).toBe(true);
        expect((await r2.getFromR2(body.fileUrl))?.equals(bytes)).toBe(true);
        const [cut] = await database.owner.select({ key: dailySalesCuts.rawFileUrl }).from(dailySalesCuts).where(eq(dailySalesCuts.id, cutId));
        expect(cut.key).toBe(body.fileUrl);
        const read = await context.request.get(`/api/sales/cuts/${cutId}/pos-file`);
        expect(read.status()).toBe(200);
        const file = (await read.json()).data;
        expect(file.fileKey).toBe(body.fileUrl);
        expect(Buffer.from(await (await context.request.get(file.url)).body()).equals(bytes)).toBe(true);
        return body;
      };
      const first = await upload(10, '', 'inicial.csv', { inserted: 1, updated: 0, skipped: 0, revenueComplete: false });
      const initial = await scenario.state();
      expect(initial.batches.find(batch => batch.id === scenario.batchIds[0])!.quantity).toBe('10.0000');
      const repeat = await upload(10, '', 'renombrado.csv', { inserted: 0, updated: 0, skipped: 1, revenueComplete: false });
      expect(repeat.fileUrl).not.toBe(first.fileUrl);
      expect(await scenario.state()).toEqual(initial);
      const bulk = await context.request.post('/api/inventory/sales-entry/bulk', { data: {
        branchId: scenario.branchId, csvText: csv(12), mapping, defaultDay: day,
      } });
      expect(bulk.status()).toBe(200);
      expect(await bulk.json()).toMatchObject({ inserted: 0, updated: 1, skipped: 0, revenueComplete: false, errors: [] });
      const corrected = await scenario.state();
      expect(corrected.identities).toEqual(initial.identities);
      expect(corrected.batches.find(batch => batch.id === scenario.batchIds[0])!.quantity).toBe('8.0000');
      await upload(8, '', 'reduccion.csv', { inserted: 0, updated: 1, skipped: 0, revenueComplete: false, errors: [] });
      const reduced = await scenario.state();
      expect(reduced.batches.find(batch => batch.id === scenario.batchIds[0])!.quantity).toBe('12.0000');
      await upload(8, '80.25', 'ingreso.csv', { inserted: 0, updated: 1, skipped: 0, revenueComplete: true, errors: [] });
      const completed = await scenario.state();
      expect(completed.movements).toEqual(reduced.movements);
      expect(completed.sales[0]).toMatchObject({ quantity: '8.00', revenue: 8025 });
      expect(completed.revisions).toHaveLength(4);
      const insufficient = await upload(21, '210', 'insuficiente.csv', { inserted: 0, updated: 0, skipped: 0, revenueComplete: false });
      expect(insufficient.sales.errors).toHaveLength(1);
      expect(insufficient.sales.errors[0]).toMatchObject({ rowNumber: 2 });
      expect(insufficient.warning).toContain('omitida por errores');
      expect(await scenario.state()).toEqual(completed);
      const linked = await context.request.post('/api/workflows/smart-links/upload-pos', { data: {
        branchId: scenario.branchId, businessDate: day, fileUrl: first.fileUrl,
      } });
      expect(linked.status()).toBe(200);
      const linkedData = (await linked.json()).data;
      expect(linkedData).toMatchObject({ fileUrl: first.fileUrl, matchedCount: 1 });
      expect(linkedData).not.toHaveProperty('sales');
      expect(await scenario.state()).toEqual(completed);
      const [relinked] = await database.owner.select({ key: dailySalesCuts.rawFileUrl }).from(dailySalesCuts).where(eq(dailySalesCuts.id, cutId));
      expect(relinked.key).toBe(first.fileUrl);
      const last = await upload(0, '0', 'cancelacion.csv', { inserted: 0, updated: 1, skipped: 0, revenueComplete: true, errors: [] });
      const cancelled = await scenario.state();
      expect(cancelled.batches.map(batch => batch.quantity)).toEqual(['20.0000', '20.0000']);
      expect(cancelled.identities).toEqual(initial.identities);
      expect(cancelled.identities[0]).toMatchObject({ source: 'pos:import', productKey: 'POS-01', day });
      expect(cancelled.revisions).toHaveLength(5);
      expect(cancelled.sales[0]).toMatchObject({ quantity: '0.00', revenue: 0 });
      expect((await list()).Contents).toHaveLength(6);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.tmp/pos-workflow-${executor}-next-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: `.tmp/pos-workflow-${executor}-next-desktop.png`, fullPage: true });
      const persisted = page.waitForResponse(response => new URL(response.url()).pathname === `/api/workflows/executions/${workflow.instanceId}/steps/pos` && response.request().method() === 'PATCH', { timeout: 90_000 });
      await page.getByRole('button', { name: executor === 'alternate' ? 'Siguiente' : 'Siguiente Paso', exact: true }).click();
      expect((await persisted).status()).toBe(200);
      if (executor === 'alternate') await browserExpect(page.getByText('Paso 2 de 2', { exact: true })).toBeVisible();
      else await browserExpect(page.getByText('Revisión final sintética', { exact: true })).toBeVisible();
      const saved = await workflow.state();
      expect(saved.step).toMatchObject({ status: 'COMPLETED', evidenceUrl: last.fileUrl, completedBy: scenario.actorId });
      expect(saved.step.value).toMatchObject({ businessDate: day, fileName: 'cancelacion.csv',
        sales: { inserted: 0, updated: 1, skipped: 0, revenueComplete: true, errors: [] } });
      expect(saved.instance.status).toBe('IN_PROGRESS');
      expect(await scenario.state()).toEqual(cancelled);
      expect(errors).toEqual([]);
      expect((await context.request.post('/api/auth/sign-out', { headers: { origin: server.baseURL }, data: {} })).status()).toBe(200);
      expect((await context.request.get(`/api/sales/cuts/${cutId}/pos-file`)).status()).toBe(401);
      const rejected = await context.request.post('/api/workflows/smart-links/upload-pos', { multipart: {
        branchId: scenario.branchId, businessDate: day, file: { name: 'sesion-cerrada.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(1)) },
      } });
      expect(rejected.status()).toBe(401);
      expect(await scenario.state()).toEqual(cancelled);
      expect((await list()).Contents).toHaveLength(6);
    } finally { await context.close(); }
  } finally {
    try { await browser?.close(); }
    finally {
      try { await server?.close(); }
      finally {
        try {
          const objects = await list();
          expect(objects.IsTruncated).not.toBe(true);
          const keys = (objects.Contents ?? []).map(object => object.Key!);
          for (const key of keys) expect(key.startsWith(prefix)).toBe(true);
          const removed = await Promise.allSettled(keys.map(key => r2.deleteFromR2(key)));
          expect(removed.filter(result => result.status === 'rejected')).toEqual([]);
          expect((await list()).Contents ?? []).toEqual([]);
        } finally { storage.destroy(); }
      }
    }
  }
}
