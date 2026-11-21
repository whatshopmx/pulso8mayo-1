import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { chromium } from '@playwright/test';
import { expect } from 'vitest';
import { dailySalesCuts } from '@/lib/db/schema';
import type { createSalesRuntimeDatabase } from './sales-runtime-database';
import { startSalesRuntimeNextServer } from './sales-runtime-next-server';
import { seedCsvRuntimeScenario } from './csv-runtime-scenario';

export async function verifyPosRuntimeScenario(database: Awaited<ReturnType<typeof createSalesRuntimeDatabase>>) {
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
    server = await startSalesRuntimeNextServer(database);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ baseURL: server.baseURL });
    try {
      expect((await context.request.post('/api/auth/sign-in/email', { headers: { origin: server.baseURL },
        data: { email: `${scenario.actorId}@example.invalid`, password: scenario.password } })).status()).toBe(200);
      const mapping = { recipeRef: 'Producto', quantitySold: 'Cantidad', productKey: 'SKU', totalRevenue: 'Ingreso' };
      const csv = (quantity: number, revenue = '') => `SKU,Producto,Cantidad,Ingreso\nPOS-01,"${scenario.recipeNames[0]}",${quantity},${revenue}`;
      const upload = async (quantity: number, revenue: string, name: string, expected: object) => {
        const bytes = Buffer.from(csv(quantity, revenue));
        const response = await context.request.post('/api/workflows/smart-links/upload-pos', { multipart: {
          branchId: scenario.branchId, businessDate: day, mapping: JSON.stringify(mapping),
          file: { name, mimeType: 'text/csv', buffer: bytes },
        } });
        expect(response.status()).toBe(200);
        const body = (await response.json()).data;
        expect(body).toMatchObject({ durable: true, matchedCount: 1, sales: expected });
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
      await upload(0, '0', 'cancelacion.csv', { inserted: 0, updated: 1, skipped: 0, revenueComplete: true, errors: [] });
      const cancelled = await scenario.state();
      expect(cancelled.batches.map(batch => batch.quantity)).toEqual(['20.0000', '20.0000']);
      expect(cancelled.identities).toEqual(initial.identities);
      expect(cancelled.identities[0]).toMatchObject({ source: 'pos:import', productKey: 'POS-01', day });
      expect(cancelled.revisions).toHaveLength(5);
      expect(cancelled.sales[0]).toMatchObject({ quantity: '0.00', revenue: 0 });
      expect((await list()).Contents).toHaveLength(6);
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
