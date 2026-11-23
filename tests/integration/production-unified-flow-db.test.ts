import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';
import {
  branches,
  companies,
  inventoryBatches,
  inventoryItems,
  productionResults,
  recipeItems,
  recipes,
  recipeVersions,
  users,
} from '@/lib/db/schema';

const previous = {
  database: process.env.DATABASE_URL,
  runtime: process.env.SALES_RUNTIME_DATABASE_URL,
};

let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let publishPolicy: typeof import('@/lib/services/recipe-consumption-publication').publishRecipeConsumptionPolicy;
let ProductionService: typeof import('@/lib/services/production-service').ProductionService;
let PrepListService: typeof import('@/lib/services/prep-list-service').PrepListService;
let HoldTimeService: typeof import('@/lib/services/hold-time-service').HoldTimeService;
let produceRecipeWithFefo: typeof import('@/lib/services/recipe-production').produceRecipeWithFefo;

describe('PROD-02 (V2 PostgreSQL nativo): unificación de prep list, orden, resultado, lote terminado y hold time', () => {
  beforeAll(async () => {
    fixture = await createSalesRuntimeDatabase({ baseline: '0158' });
    await fixture.owner.transaction(async tx => {
      for (const file of [
        '0159_inv02_consumption_policy.sql',
        '0160_inv02_policy_publication_access.sql',
        '0161_prod01a_finished_batch_link.sql',
        '0162_prod01b_finished_consumption_grants.sql',
      ]) {
        const statements = readFileSync(`drizzle/${file}`, 'utf8')
          .split('--> statement-breakpoint')
          .filter(value => value.trim());
        for (const statement of statements) {
          await tx.execute(sql.raw(statement.replaceAll('pulso_app', fixture!.roleName)));
        }
      }
    });

    process.env.DATABASE_URL = fixture.ownerUrl;
    process.env.SALES_RUNTIME_DATABASE_URL = fixture.runtimeUrl;

    publishPolicy = (await import('@/lib/services/recipe-consumption-publication')).publishRecipeConsumptionPolicy;
    ProductionService = (await import('@/lib/services/production-service')).ProductionService;
    PrepListService = (await import('@/lib/services/prep-list-service')).PrepListService;
    HoldTimeService = (await import('@/lib/services/hold-time-service')).HoldTimeService;
    produceRecipeWithFefo = (await import('@/lib/services/recipe-production')).produceRecipeWithFefo;
  }, 180_000);

  afterAll(async () => {
    try {
      await fixture?.close();
    } finally {
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.runtime === undefined) delete process.env.SALES_RUNTIME_DATABASE_URL;
      else process.env.SALES_RUNTIME_DATABASE_URL = previous.runtime;
    }
  }, 90_000);

  it('comparte production_orders entre prep list y órdenes, enlaza lote terminado y expone saldo/caducidad/procedencia en órdenes y hold time', async () => {
    const owner = fixture!.owner;
    const companyId = randomUUID();
    const branchId = randomUUID();
    const actorId = `prod02-admin-${randomUUID().slice(0, 8)}`;
    const today = new Date().toISOString().split('T')[0];
    const futureExp = new Date('2027-06-01T00:00:00Z');

    const rawId = randomUUID();
    const finishedSkuId = randomUUID();
    const recipeId = randomUUID();
    const versionId = randomUUID();
    const rawBatchId = randomUUID();

    await owner.insert(companies).values({ id: companyId, name: 'Empresa PROD-02' });
    await owner.insert(branches).values({ id: branchId, companyId, name: 'Sucursal Norte', timezone: 'America/Mexico_City' });
    await owner.insert(users).values({
      id: actorId,
      email: `${actorId}@pulso.test`,
      name: 'Chef PROD-02',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await owner.insert(inventoryItems).values([
      { id: rawId, companyId, name: 'Chile Poblano', unit: 'KG', currentStock: 20 },
      { id: finishedSkuId, companyId, name: 'Salsa Poblana (Elaborado)', unit: 'KG', currentStock: 0 },
    ]);

    await owner.insert(inventoryBatches).values({
      id: rawBatchId,
      itemId: rawId,
      branchId,
      lotNumber: 'L-POBLANO-01',
      initialQuantity: '20.0000',
      currentQuantity: '20.0000',
      unitCost: 2500,
      status: 'AVAILABLE',
      origin: 'PURCHASE',
      expirationDate: futureExp,
    });

    await owner.insert(recipes).values({
      id: recipeId,
      companyId,
      name: 'Salsa Poblana',
      baseYield: '1.00',
      unit: 'KG',
      isSubRecipe: true,
      holdTimeMinutes: 30,
    });

    await owner.insert(recipeItems).values({
      recipeId,
      itemId: rawId,
      quantity: '2.0000',
      unit: 'KG',
      isSubRecipe: false,
      yieldPercent: 100,
    });

    await owner.insert(recipeVersions).values({
      id: versionId,
      companyId,
      recipeId,
      versionNumber: 1,
      name: 'Salsa Poblana v1',
      baseYield: '1.00',
      unit: 'KG',
      calculatedCost: 5000,
      priceSelling: 0,
      foodCostPercentage: '0.00',
      changedBy: actorId,
      itemsSnapshot: [{ itemId: rawId, quantity: '2.0000', unit: 'KG', isSubRecipe: false, yieldPercent: 100 }],
    });

    await publishPolicy(
      { userId: actorId, role: 'ADMIN', companyId, branchId: null },
      {
        recipeId,
        recipeVersionId: versionId,
        effectiveFrom: '2026-11-01',
        mode: 'FINISHED_PRODUCT_ON_SALE',
        inventoryItemId: finishedSkuId,
        unit: 'KG',
        reason: 'Salsa Poblana controlada por lote terminado',
      }
    );

    // 1. Crear línea en Prep List y verificar que aparece en ProductionService.getOrders (mismo modelo).
    const prepLine = await PrepListService.createLine({
      companyId,
      branchId,
      recipeId,
      plannedQuantity: 2,
      unit: 'KG',
      plannedDate: new Date(`${today}T00:00:00Z`),
      station: 'Caliente',
      shift: null,
      createdBy: actorId,
    });

    const ordersBefore = await ProductionService.getOrders(companyId, branchId);
    expect(ordersBefore.some(o => o.order.id === prepLine.id && o.order.status === 'PLANNED')).toBe(true);

    // 2. Completar desde Prep List -> cierra orden, descuenta insumos FEFO y crea lote terminado.
    const completed = await PrepListService.completeLine({
      companyId,
      branchId,
      orderId: prepLine.id,
      producedQuantity: 2,
      userId: actorId,
    });
    expect(completed.orderId).toBe(prepLine.id);
    expect(completed.finishedBatchId).toBeTruthy();

    // 3. ProductionService.getOrders expone la orden COMPLETED + finishedBatch con saldo, caducidad y procedencia.
    const ordersAfterPrep = await ProductionService.getOrders(companyId, branchId);
    const closedPrep = ordersAfterPrep.find(o => o.order.id === prepLine.id);
    expect(closedPrep?.order.status).toBe('COMPLETED');
    expect(closedPrep?.finishedBatch).toMatchObject({
      id: completed.finishedBatchId,
      itemName: 'Salsa Poblana (Elaborado)',
      currentQuantity: '2.0000',
      initialQuantity: '2.0000',
      unit: 'KG',
      origin: 'PRODUCTION',
      parentBatchCount: 1,
    });
    expect(closedPrep?.finishedBatch?.expirationDate).toBeTruthy();

    // 4. HoldTimeService.getBoard expone la misma tanda en línea con su lote terminado (saldo + procedencia).
    // Ajustamos expires_at a +10 min para que aparezca en expiringSoon dentro de la ventana de alerta.
    await owner
      .update(productionResults)
      .set({ expiresAt: sql`now() + interval '10 minutes'` })
      .where(eq(productionResults.id, completed.resultId));

    const board = await HoldTimeService.getBoard({ companyId, branchId, warningMinutes: 30 });
    const holdLine = board.expiringSoon.find(l => l.id === completed.resultId);
    expect(holdLine).toBeDefined();
    expect(holdLine?.finishedBatch).toMatchObject({
      id: completed.finishedBatchId,
      currentQuantity: '2.0000',
      unit: 'KG',
      origin: 'PRODUCTION',
      parentBatchCount: 1,
    });

    // 5. Segunda orden creada vía ProductionService.createOrder y cerrada vía produceRecipeWithFefo(orderId)
    // también transiciona a COMPLETED y enlaza su propio lote terminado.
    const manualOrder = await ProductionService.createOrder({
      companyId,
      branchId,
      recipeId,
      plannedQuantity: 1,
      unit: 'KG',
      plannedDate: new Date(`${today}T00:00:00Z`),
      createdBy: actorId,
    });

    const manualOutcome = await owner.transaction(tx =>
      produceRecipeWithFefo(tx, {
        companyId,
        branchId,
        recipeId,
        quantity: 1,
        unit: 'KG',
        recordedBy: actorId,
        orderId: manualOrder.id,
      })
    );
    expect(manualOutcome.status).toBe('produced');
    if (manualOutcome.status === 'produced') {
      expect(manualOutcome.finishedBatchId).toBeTruthy();
      const ordersFinal = await ProductionService.getOrders(companyId, branchId);
      const closedManual = ordersFinal.find(o => o.order.id === manualOrder.id);
      expect(closedManual?.order.status).toBe('COMPLETED');
      expect(closedManual?.finishedBatch).toMatchObject({
        id: manualOutcome.finishedBatchId,
        currentQuantity: '1.0000',
        initialQuantity: '1.0000',
        origin: 'PRODUCTION',
        parentBatchCount: 1,
      });
    }
  }, 120_000);
});
