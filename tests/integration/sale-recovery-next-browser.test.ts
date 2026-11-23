import { createHash, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import {
  account,
  users,
  companies,
  branches,
  inventoryItems,
  recipes,
  recipeItems,
  inventoryBatches,
  inventoryMovements,
  inventoryAuditLog,
  salesEntries,
  salesConsumptionRevisions,
} from '@/lib/db/schema';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';
import { startSalesRuntimeNextServer } from './helpers/sales-runtime-next-server';

// Opt-in V2/V3 integrated test for INV-01.c.recovery.ui-routes:
// Real Next production server, Chromium, Better Auth (two distinct ADMIN users),
// isolated disposable Neon DB (baseline 0158) and real private R2 storage.
const enabled = process.env.RUN_SALE_RECOVERY_NEXT_BROWSER === '1';
const originalDatabaseUrl = process.env.DATABASE_URL;
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;

beforeAll(async () => {
  if (!enabled) return;
  fixture = await createSalesRuntimeDatabase({ baseline: '0158' });
  process.env.DATABASE_URL = fixture.ownerUrl;
}, 150_000);

afterAll(async () => {
  try { await fixture?.close(); }
  finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}, 90_000);

it.skipIf(!enabled)(
  'Next + Chromium + Better Auth + R2: full historical sale recovery UI flow with segregation of duties and AUD-02',
  async () => {
    config({ path: '.env', quiet: true });
    const r2 = await import('@/lib/storage/r2-client');
    expect(r2.isR2Configured(), 'INV-01.c.recovery.ui-routes V2/V3 requires real R2').toBe(true);

    const database = fixture!;
    const companyId = randomUUID();
    const branchId = randomUUID();
    const itemId = randomUUID();
    const recipeId = randomUUID();
    const batchId = randomUUID();
    const legacySaleId = randomUUID();
    const requesterId = randomUUID();
    const reviewerId = randomUUID();
    const password = `Synthetic-${randomUUID()}`;
    const now = new Date();
    const passwordHash = await hashPassword(password);
    const saleDay = '2026-11-16';
    const prefix = `companies/${companyId}/`;

    const storage = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    });
    const bucket = process.env.R2_BUCKET_NAME || 'pulso-documents';
    const listObjects = () => storage.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));

    await database.owner.transaction(async tx => {
      await tx.insert(companies).values({ id: companyId, name: 'Synthetic Next Recovery Company' });
      await tx.insert(branches).values({ id: branchId, companyId, name: 'Synthetic Next Recovery Branch' });
      await tx.insert(inventoryItems).values({ id: itemId, companyId, name: 'Synthetic Recovery Ingredient', unit: 'KG' });
      await tx.insert(recipes).values({ id: recipeId, companyId, name: 'Synthetic Recovery Dish', baseYield: '1', unit: 'PORTION' });
      await tx.insert(recipeItems).values({ recipeId, itemId, quantity: '1', unit: 'KG', yieldPercent: 100 });
      await tx.insert(inventoryBatches).values({
        id: batchId,
        branchId,
        itemId,
        initialQuantity: '20.0000',
        currentQuantity: '20.0000',
        unitCost: 100,
        status: 'AVAILABLE',
        expirationDate: new Date('2029-12-31T00:00:00Z'),
        receivedAt: new Date('2026-10-01T00:00:00Z'),
      });
      await tx.insert(salesEntries).values({
        id: legacySaleId,
        companyId,
        branchId,
        recipeId,
        quantitySold: '3',
        totalRevenue: 1200,
        saleDate: new Date(`${saleDay}T00:00:00Z`),
      });
      await tx.insert(users).values([
        { id: requesterId, companyId, branchId, role: 'ADMIN', email: `${requesterId}@example.invalid`, name: 'Synthetic Requester', emailVerified: true, createdAt: now, updatedAt: now },
        { id: reviewerId, companyId, branchId, role: 'ADMIN', email: `${reviewerId}@example.invalid`, name: 'Synthetic Reviewer', emailVerified: true, createdAt: now, updatedAt: now },
      ]);
      await tx.insert(account).values([requesterId, reviewerId].map(userId => ({
        id: randomUUID(), userId, accountId: userId, providerId: 'credential', password: passwordHash, createdAt: now, updatedAt: now,
      })));
    });

    const server = await startSalesRuntimeNextServer(database);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });

      // 1. Requester session: upload 3 real private JSON documents to R2 & attest them via real HTTP routes
      const reqContext = await browser.newContext({ baseURL: server.baseURL, timezoneId: 'America/Mexico_City', viewport: { width: 1440, height: 1000 } });
      let proposalId = '';
      try {
        expect((await reqContext.request.post('/api/auth/sign-in/email', {
          headers: { origin: server.baseURL },
          data: { email: `${requesterId}@example.invalid`, password },
        })).status()).toBe(200);
        await reqContext.addCookies([{ name: 'pulso_selected_branch', value: branchId, url: server.baseURL }]);

        const subject = { companyId, branchId, legacySaleId, recipeId, sourceReference: 'Corte fiscal sintético 001' };
        const core = { schemaVersion: 1, ...subject, source: 'pos:main', productKey: 'SKU-REC-01', saleDay, quantitySold: '3', totalRevenueCents: 1200 };
        const docs = [
          { ...core, kind: 'SALE_RECOVERY_SALE' },
          {
            schemaVersion: 1,
            kind: 'SALE_RECOVERY_RECIPE',
            ...subject,
            saleDay,
            validFrom: '2026-10-01',
            validThrough: '2026-11-30',
            recipes: [{
              id: recipeId,
              companyId,
              baseYield: '1',
              unit: 'PORTION',
              items: [{ id: randomUUID(), itemId, quantity: '1', unit: 'KG', isSubRecipe: false, yieldPercent: 100 }],
            }],
            ingredients: [{ id: itemId, companyId, unit: 'KG' }],
            conversions: [],
          },
          {
            ...core,
            kind: 'SALE_RECOVERY_NO_PRIOR_CONSUMPTION',
            consumptionState: 'NOT_APPLIED',
            basis: { system: 'POS', recordReference: 'Registro íntegro 001', explanation: 'Sin consumo previo verificado' },
          },
        ];
        const purposes = ['SALE', 'RECIPE_VERSION', 'NO_PRIOR_CONSUMPTION'] as const;
        const attestationIds: string[] = [];

        for (let i = 0; i < 3; i++) {
          const buffer = Buffer.from(JSON.stringify(docs[i]), 'utf8');
          const sha256 = createHash('sha256').update(buffer).digest('hex');
          const uploadRes = await reqContext.request.post('/api/inventory/sales-entry/recovery-evidence', {
            multipart: {
              branchId,
              legacySaleId,
              file: { name: `doc-${i}.json`, mimeType: 'application/json', buffer },
            },
          });
          expect(uploadRes.status()).toBe(201);
          const evidenceId = (await uploadRes.json()).data.id as string;

          const attestRes = await reqContext.request.post('/api/inventory/sales-entry/recovery-attestations', {
            data: {
              branchId,
              legacySaleId,
              evidenceId,
              idempotencyKey: randomUUID(),
              purpose: purposes[i],
              sourceReference: 'Corte fiscal sintético 001',
              reason: 'Verificación documental real en R2',
              expectedContentSha256: sha256,
            },
          });
          expect(attestRes.status()).toBe(201);
          attestationIds.push((await attestRes.json()).data.id as string);
        }

        expect((await listObjects()).Contents).toHaveLength(3);

        // 2. Requester opens real /dashboard/inventory/sales-entry UI and creates proposal
        const page = await reqContext.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('/dashboard/inventory/sales-entry', { timeout: 90_000 });
        await page.getByRole('button', { name: 'Recuperación Histórica', exact: true }).click();
        await page.getByRole('button', { name: 'Crear expediente', exact: true }).click();
        await page.getByLabel('Venta por recuperar', { exact: true }).fill(legacySaleId);
        await page.getByLabel('Atestación de venta', { exact: true }).fill(attestationIds[0]);
        await page.getByLabel('Atestación de receta histórica', { exact: true }).fill(attestationIds[1]);
        await page.getByLabel('Atestación de ausencia de consumo', { exact: true }).fill(attestationIds[2]);
        await page.getByLabel('Motivo de recuperación', { exact: true }).fill('Conciliación documental real de venta legada');

        const createResponse = page.waitForResponse(
          res => new URL(res.url()).pathname === '/api/inventory/sales-entry/recovery-proposals' && res.request().method() === 'POST',
          { timeout: 90_000 },
        );
        await page.getByRole('button', { name: 'Registrar expediente', exact: true }).click();
        const created = await createResponse;
        expect(created.status()).toBe(201);
        proposalId = (await created.json()).data.id as string;

        // Segregation of duties: requester sees the proposal but CANNOT approve or apply
        await browserExpect(page.getByText(proposalId, { exact: true })).toBeVisible({ timeout: 30_000 });
        await browserExpect(page.getByText(/Segregación de funciones: El usuario que solicitó/i)).toBeVisible();
        await browserExpect(page.getByRole('button', { name: 'Registrar Decisión' })).toHaveCount(0);
        await browserExpect(page.getByRole('button', { name: 'Aplicar Consumo e Inventario' })).toHaveCount(0);
        expect(errors).toEqual([]);

        // Stock must remain untouched before independent approval & apply
        const [batchBefore] = await database.owner.select({ qty: inventoryBatches.currentQuantity }).from(inventoryBatches).where(eq(inventoryBatches.id, batchId));
        expect(batchBefore.qty).toBe('20.0000');
      } finally {
        await reqContext.close();
      }

      // 3. Independent Reviewer session: opens the proposal in UI, approves and applies AUD-02 recovery
      const revContext = await browser.newContext({ baseURL: server.baseURL, timezoneId: 'America/Mexico_City', viewport: { width: 1440, height: 1000 } });
      try {
        expect((await revContext.request.post('/api/auth/sign-in/email', {
          headers: { origin: server.baseURL },
          data: { email: `${reviewerId}@example.invalid`, password },
        })).status()).toBe(200);
        await revContext.addCookies([{ name: 'pulso_selected_branch', value: branchId, url: server.baseURL }]);

        const page = await revContext.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('/dashboard/inventory/sales-entry', { timeout: 90_000 });
        await page.getByRole('button', { name: 'Recuperación Histórica', exact: true }).click();
        await page.getByLabel('ID del Expediente (UUID)', { exact: true }).fill(proposalId);
        await page.getByRole('button', { name: 'Consultar', exact: true }).click();
        await browserExpect(page.getByRole('button', { name: 'Registrar Decisión', exact: true })).toBeVisible({ timeout: 30_000 });

        const decisionResponse = page.waitForResponse(
          res => new URL(res.url()).pathname === '/api/inventory/sales-entry/recovery-decisions' && res.request().method() === 'POST',
          { timeout: 90_000 },
        );
        await page.getByRole('button', { name: 'Registrar Decisión', exact: true }).click();
        expect((await decisionResponse).status()).toBe(201);
        await browserExpect(page.getByText('Aprobado', { exact: true })).toBeVisible({ timeout: 30_000 });

        await page.getByLabel('Motivo de Auditoría AUD-02 *', { exact: true }).fill('Aplicación auditada de venta legada corte 001');
        const applyResponse = page.waitForResponse(
          res => new URL(res.url()).pathname === '/api/inventory/sales-entry/recovery-apply' && res.request().method() === 'POST',
          { timeout: 90_000 },
        );
        await page.getByRole('button', { name: 'Aplicar Consumo e Inventario', exact: true }).click();
        expect((await applyResponse).status()).toBe(200);
        await browserExpect(page.getByText('¡Recuperación histórica aplicada exitosamente!', { exact: true })).toBeVisible({ timeout: 30_000 });
        expect(errors).toEqual([]);

        // Independent SQL oracles after commit
        const [batchAfter] = await database.owner.select({ qty: inventoryBatches.currentQuantity }).from(inventoryBatches).where(eq(inventoryBatches.id, batchId));
        expect(batchAfter.qty).toBe('17.0000');
        const revisions = await database.owner.select().from(salesConsumptionRevisions).where(eq(salesConsumptionRevisions.companyId, companyId));
        expect(revisions).toHaveLength(1);
        expect(revisions[0].revision).toBe(1);
        const movements = await database.owner.select().from(inventoryMovements).where(eq(inventoryMovements.branchId, branchId));
        expect(movements).toHaveLength(1);
        expect(movements[0].quantityChange).toBe('-3.0000');
        const audits = await database.owner.select().from(inventoryAuditLog).where(and(eq(inventoryAuditLog.companyId, companyId), eq(inventoryAuditLog.branchId, branchId)));
        expect(audits.length).toBeGreaterThanOrEqual(1);

        // Idempotent replay via API returns alreadyApplied: true without moving stock again
        const replay = await revContext.request.post('/api/inventory/sales-entry/recovery-apply', {
          data: { branchId, proposalId, reason: 'Reintento idempotente AUD-02' },
        });
        expect(replay.status()).toBe(200);
        expect((await replay.json()).data).toMatchObject({ applied: false, alreadyApplied: true });
        const [batchAfterReplay] = await database.owner.select({ qty: inventoryBatches.currentQuantity }).from(inventoryBatches).where(eq(inventoryBatches.id, batchId));
        expect(batchAfterReplay.qty).toBe('17.0000');

        // Sign-out blocks recovery endpoints
        expect((await revContext.request.post('/api/auth/sign-out', { headers: { origin: server.baseURL }, data: {} })).status()).toBe(200);
        expect((await revContext.request.get(`/api/inventory/sales-entry/recovery-proposals?proposalId=${proposalId}&branchId=${branchId}`)).status()).toBe(401);
      } finally {
        await revContext.close();
      }
    } finally {
      try { await browser?.close(); }
      finally {
        try { await server.close(); }
        finally {
          try {
            const objects = await listObjects();
            const keys = (objects.Contents ?? []).map(obj => obj.Key!);
            for (const key of keys) expect(key.startsWith(prefix)).toBe(true);
            await Promise.all(keys.map(key => r2.deleteFromR2(key)));
            expect((await listObjects()).Contents ?? []).toEqual([]);
          } finally { storage.destroy(); }
        }
      }
    }
  },
  240_000,
);
