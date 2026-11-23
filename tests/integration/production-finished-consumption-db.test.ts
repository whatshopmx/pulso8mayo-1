import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';
import {
  branches,
  companies,
  inventoryBatches,
  inventoryItems,
  inventoryMovements,
  productionIngredients,
  productionOrders,
  productionResults,
  recipeItems,
  recipes,
  recipeVersions,
  salesConsumptionRevisions,
  users,
} from '@/lib/db/schema';

const previous = {
  database: process.env.DATABASE_URL,
  runtime: process.env.SALES_RUNTIME_DATABASE_URL,
  policy: process.env.SALES_RECIPE_POLICY_MODE,
};

let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let publishPolicy: typeof import('@/lib/services/recipe-consumption-publication').publishRecipeConsumptionPolicy;
let recordProduction: typeof import('@/lib/services/production-service').ProductionService.recordProduction;
let ingestSales: typeof import('@/lib/services/sales-ingest-service').SalesIngestService.ingest;
let withRuntime: typeof import('@/lib/db/sales-runtime').withSalesWriterTransaction;
let applySaleInTx: typeof import('@/lib/services/sale-consumption-service').applySaleConsumptionInTransaction;

describe('PROD-01.b (V2 PostgreSQL nativo): consumo de elaborado sin doble descuento y con genealogía', () => {
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
    process.env.SALES_RECIPE_POLICY_MODE = 'PUBLISHED';

    publishPolicy = (await import('@/lib/services/recipe-consumption-publication')).publishRecipeConsumptionPolicy;
    recordProduction = (await import('@/lib/services/production-service')).ProductionService.recordProduction;
    const { SalesIngestService } = await import('@/lib/services/sales-ingest-service');
    ingestSales = input => SalesIngestService.ingest(input);
    withRuntime = (await import('@/lib/db/sales-runtime')).withSalesWriterTransaction;
    applySaleInTx = (await import('@/lib/services/sale-consumption-service')).applySaleConsumptionInTransaction;
  }, 180_000);

  afterAll(async () => {
    try {
      await fixture?.close();
    } finally {
      for (const [name, value] of [
        ['DATABASE_URL', previous.database],
        ['SALES_RUNTIME_DATABASE_URL', previous.runtime],
        ['SALES_RECIPE_POLICY_MODE', previous.policy],
      ]) {
        if (value === undefined) delete process.env[name!];
        else process.env[name!] = value;
      }
    }
  }, 90_000);

  it('produce subreceta, vende platillo y subreceta sin descontar insumos dos veces, conserva genealogía y resiste reintentos/correcciones', async () => {
    const owner = fixture!.owner;
    const companyId = randomUUID();
    const branchId = randomUUID();
    const actorId = `prod01b-admin-${randomUUID().slice(0, 8)}`;
    const saleDay = '2026-12-01';
    const futureExp = new Date('2027-06-01T00:00:00Z');

    const tomatilloId = randomUUID();
    const tortillaId = randomUUID();
    const salsaSkuId = randomUUID();
    const salsaRecipeId = randomUUID();
    const tacosRecipeId = randomUUID();
    const salsaVersionId = randomUUID();
    const tacosVersionId = randomUUID();
    const tomatilloBatchId = randomUUID();
    const tortillaBatchId = randomUUID();
    const decoyPurchaseBatchId = randomUUID();
    const orderId = randomUUID();
    const workflowInstanceId = randomUUID();

    await owner.insert(companies).values({ id: companyId, name: 'Empresa PROD-01.b' });
    await owner.insert(branches).values({ id: branchId, companyId, name: 'Sucursal Central' });
    await owner.insert(users).values({
      id: actorId,
      email: `${actorId}@pulso.test`,
      name: 'Admin PROD-01.b',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await owner.insert(inventoryItems).values([
      { id: tomatilloId, companyId, name: 'Tomatillo', unit: 'KG', currentStock: 10 },
      { id: tortillaId, companyId, name: 'Tortilla', unit: 'KG', currentStock: 10 },
      { id: salsaSkuId, companyId, name: 'Salsa Verde (Elaborado)', unit: 'KG', currentStock: 5 },
    ]);

    await owner.insert(inventoryBatches).values([
      {
        id: tomatilloBatchId,
        itemId: tomatilloId,
        branchId,
        initialQuantity: '10.0000',
        currentQuantity: '10.0000',
        unitCost: 3000,
        status: 'AVAILABLE',
        origin: 'PURCHASE',
        expirationDate: futureExp,
      },
      {
        id: tortillaBatchId,
        itemId: tortillaId,
        branchId,
        initialQuantity: '10.0000',
        currentQuantity: '10.0000',
        unitCost: 2000,
        status: 'AVAILABLE',
        origin: 'PURCHASE',
        expirationDate: futureExp,
      },
      // Lote de compra del mismo SKU elaborado: NO debe consumirse como elaborado sin genealogía de producción.
      {
        id: decoyPurchaseBatchId,
        itemId: salsaSkuId,
        branchId,
        initialQuantity: '5.0000',
        currentQuantity: '5.0000',
        unitCost: 5000,
        status: 'AVAILABLE',
        origin: 'PURCHASE',
        expirationDate: futureExp,
      },
    ]);

    await owner.insert(recipes).values([
      {
        id: salsaRecipeId,
        companyId,
        name: 'Salsa Verde',
        baseYield: '1.00',
        unit: 'KG',
        isSubRecipe: true,
        holdTimeMinutes: 24 * 60,
      },
      {
        id: tacosRecipeId,
        companyId,
        name: 'Tacos Verdes',
        baseYield: '1.00',
        unit: 'PORTION',
        isSubRecipe: false,
      },
    ]);

    await owner.insert(recipeItems).values([
      { recipeId: salsaRecipeId, itemId: tomatilloId, quantity: '2.0000', unit: 'KG', isSubRecipe: false, yieldPercent: 100 },
      { recipeId: tacosRecipeId, itemId: tortillaId, quantity: '0.2500', unit: 'KG', isSubRecipe: false, yieldPercent: 100 },
      { recipeId: tacosRecipeId, itemId: salsaRecipeId, quantity: '0.5000', unit: 'KG', isSubRecipe: true, yieldPercent: 100 },
    ]);

    await owner.insert(recipeVersions).values([
      {
        id: salsaVersionId,
        companyId,
        recipeId: salsaRecipeId,
        versionNumber: 1,
        name: 'Salsa Verde v1',
        baseYield: '1.00',
        unit: 'KG',
        calculatedCost: 6000,
        priceSelling: 0,
        foodCostPercentage: '0.00',
        changedBy: actorId,
        itemsSnapshot: [
          { itemId: tomatilloId, quantity: '2.0000', unit: 'KG', isSubRecipe: false, yieldPercent: 100 },
        ],
      },
      {
        id: tacosVersionId,
        companyId,
        recipeId: tacosRecipeId,
        versionNumber: 1,
        name: 'Tacos Verdes v1',
        baseYield: '1.00',
        unit: 'PORTION',
        calculatedCost: 3500,
        priceSelling: 12000,
        foodCostPercentage: '29.17',
        changedBy: actorId,
        itemsSnapshot: [
          { itemId: tortillaId, quantity: '0.2500', unit: 'KG', isSubRecipe: false, yieldPercent: 100 },
          { itemId: salsaRecipeId, quantity: '0.5000', unit: 'KG', isSubRecipe: true, yieldPercent: 100 },
        ],
      },
    ]);

    const actor = { userId: actorId, role: 'ADMIN' as const, companyId, branchId: null };
    await publishPolicy(actor, {
      recipeId: salsaRecipeId,
      recipeVersionId: salsaVersionId,
      effectiveFrom: '2026-11-01',
      mode: 'FINISHED_PRODUCT_ON_SALE',
      inventoryItemId: salsaSkuId,
      unit: 'KG',
      reason: 'Salsa Verde se controla por lote terminado de producción',
    });
    await publishPolicy(actor, {
      recipeId: tacosRecipeId,
      recipeVersionId: tacosVersionId,
      effectiveFrom: '2026-11-01',
      mode: 'INGREDIENTS_ON_SALE',
      reason: 'Tacos Verdes consume tortilla y subreceta Salsa Verde elaborada',
    });

    const batchQty = async (id: string) =>
      (await owner.select({ q: inventoryBatches.currentQuantity }).from(inventoryBatches).where(eq(inventoryBatches.id, id)))[0].q;

    const runSale = (recipeRef: string, quantitySold: number, totalRevenueCents: number | null) =>
      ingestSales({
        companyId,
        branchId,
        source: 'pos:prod01b',
        userId: actorId,
        rows: [{ rowNumber: 2, recipeRef, productKey: `recipe:${recipeRef}`, quantitySold, saleDay, totalRevenueCents }],
      });

    // 1. Antes de producir: vender Tacos Verdes debe rechazarse aunque exista un lote PURCHASE del SKU elaborado.
    const blockedBeforeProd = await runSale(tacosRecipeId, 2, 24000);
    expect(blockedBeforeProd.inserted).toBe(0);
    expect(blockedBeforeProd.errors).toHaveLength(1);
    expect(blockedBeforeProd.errors[0].message).toContain('Stock de lote terminado de producción insuficiente');
    expect(await batchQty(tomatilloBatchId)).toBe('10.0000');
    expect(await batchQty(tortillaBatchId)).toBe('10.0000');
    expect(await batchQty(decoyPurchaseBatchId)).toBe('5.0000');

    // 2. Producir 2 KG de Salsa Verde (consume 4 KG de Tomatillo y crea 1 lote terminado con genealogía).
    await owner.insert(productionOrders).values({
      id: orderId,
      companyId,
      branchId,
      recipeId: salsaRecipeId,
      plannedQuantity: 2,
      unit: 'KG',
      plannedDate: new Date(`${saleDay}T00:00:00Z`),
      status: 'PLANNED',
      createdBy: actorId,
    });

    const prodInput = {
      companyId,
      branchId,
      recipeId: salsaRecipeId,
      producedQuantity: 2,
      unit: 'KG',
      recordedBy: actorId,
      orderId,
      workflowInstanceId,
      finishedExpirationDate: futureExp,
      ingredients: [{ itemId: tomatilloId, expectedQuantity: 4, actualQuantity: 4, unit: 'KG' }],
    };

    const prodResult = await owner.transaction(tx => recordProduction(prodInput, tx));
    expect(prodResult).not.toBeNull();
    expect(prodResult!.finishedBatchId).toBeTruthy();
    const finishedBatchId = prodResult!.finishedBatchId!;
    expect(await batchQty(tomatilloBatchId)).toBe('6.0000');
    expect(await batchQty(finishedBatchId)).toBe('2.0000');

    // 3. Dos cierres / reintentos de producción NO duplican lotes ni movimientos.
    const replayProd = await owner.transaction(tx => recordProduction(prodInput, tx));
    expect(replayProd).toBeNull();

    await expect(
      owner.transaction(tx => recordProduction({ ...prodInput, workflowInstanceId: randomUUID() }, tx))
    ).rejects.toMatchObject({ statusCode: 409 });

    const prodBatches = await owner
      .select()
      .from(inventoryBatches)
      .where(and(eq(inventoryBatches.itemId, salsaSkuId), eq(inventoryBatches.origin, 'PRODUCTION')));
    expect(prodBatches).toHaveLength(1);
    expect(await batchQty(tomatilloBatchId)).toBe('6.0000');

    // 4. Vender 2 porciones de Tacos Verdes: descuenta 0.5000 KG Tortilla + 1.0000 KG Salsa Verde (PRODUCTION).
    // Tomatillo permanece en 6.0000 (SIN doble descuento) y el lote PURCHASE de Salsa Verde permanece intacto en 5.0000.
    const saleResult = await runSale(tacosRecipeId, 2, 24000);
    expect(saleResult).toMatchObject({ inserted: 1, errors: [] });
    expect(await batchQty(tortillaBatchId)).toBe('9.5000');
    expect(await batchQty(finishedBatchId)).toBe('1.0000');
    expect(await batchQty(tomatilloBatchId)).toBe('6.0000');
    expect(await batchQty(decoyPurchaseBatchId)).toBe('5.0000');

    // 5. Genealogía completa: revisión de venta -> lote terminado -> parentBatchIds + production_results -> production_ingredients -> lote de insumo.
    const [revision] = await owner
      .select()
      .from(salesConsumptionRevisions)
      .where(and(eq(salesConsumptionRevisions.companyId, companyId), eq(salesConsumptionRevisions.recipeId, tacosRecipeId)));
    expect(revision).toBeDefined();
    const finishedAlloc = revision.allocations.find(a => a.itemId === salsaSkuId);
    expect(finishedAlloc).toMatchObject({ batchId: finishedBatchId, remainingQuantity: '1.0000', unit: 'KG' });

    const [finishedBatchRow] = await owner.select().from(inventoryBatches).where(eq(inventoryBatches.id, finishedBatchId));
    expect(finishedBatchRow.origin).toBe('PRODUCTION');
    expect(finishedBatchRow.parentBatchIds).toEqual([tomatilloBatchId]);

    const [linkedResult] = await owner
      .select()
      .from(productionResults)
      .where(eq(productionResults.finishedBatchId, finishedBatchId));
    expect(linkedResult.id).toBe(prodResult!.id);

    const consumedRawRows = await owner
      .select()
      .from(productionIngredients)
      .where(eq(productionIngredients.resultId, linkedResult.id));
    expect(consumedRawRows).toHaveLength(1);
    expect(consumedRawRows[0]).toMatchObject({
      itemId: tomatilloId,
      batchId: tomatilloBatchId,
      actualQuantity: '4.0000',
    });

    // 6. Reintentos concurrentes de la misma venta (en rol runtime) no duplican movimientos ni descuentan dos veces.
    const movementsBeforeRetry = (await owner.select().from(inventoryMovements).where(eq(inventoryMovements.branchId, branchId))).length;
    const retrySale = () =>
      withRuntime(tx =>
        applySaleInTx(tx, {
          companyId,
          branchId,
          recipeId: tacosRecipeId,
          source: 'pos:prod01b',
          productKey: `recipe:${tacosRecipeId}`,
          saleDay,
          quantitySold: '2.00',
          totalRevenueCents: 24000,
          userId: actorId,
        })
      );
    const concurrentRetries = await Promise.all([retrySale(), retrySale()]);
    expect(concurrentRetries.every(r => r.applied === false)).toBe(true);
    expect((await owner.select().from(inventoryMovements).where(eq(inventoryMovements.branchId, branchId))).length).toBe(movementsBeforeRetry);
    expect(await batchQty(finishedBatchId)).toBe('1.0000');
    expect(await batchQty(tomatilloBatchId)).toBe('6.0000');

    // 7. Corrección (2 -> 1) y anulación (1 -> 0) devuelven al lote terminado sin tocar Tomatillo.
    await withRuntime(tx =>
      applySaleInTx(tx, {
        companyId,
        branchId,
        recipeId: tacosRecipeId,
        source: 'pos:prod01b',
        productKey: `recipe:${tacosRecipeId}`,
        saleDay,
        quantitySold: '1.00',
        totalRevenueCents: 12000,
        userId: actorId,
      })
    );
    expect(await batchQty(finishedBatchId)).toBe('1.5000');
    expect(await batchQty(tortillaBatchId)).toBe('9.7500');
    expect(await batchQty(tomatilloBatchId)).toBe('6.0000');

    await withRuntime(tx =>
      applySaleInTx(tx, {
        companyId,
        branchId,
        recipeId: tacosRecipeId,
        source: 'pos:prod01b',
        productKey: `recipe:${tacosRecipeId}`,
        saleDay,
        quantitySold: '0.00',
        totalRevenueCents: 0,
        userId: actorId,
      })
    );
    expect(await batchQty(finishedBatchId)).toBe('2.0000');
    expect(await batchQty(tortillaBatchId)).toBe('10.0000');
    expect(await batchQty(tomatilloBatchId)).toBe('6.0000');

    // 8. Venta directa de la subreceta Salsa Verde (1 KG) consume 1 KG del lote terminado sin tocar Tomatillo.
    const directSubrecipeSale = await runSale(salsaRecipeId, 1, 9000);
    expect(directSubrecipeSale).toMatchObject({ inserted: 1, errors: [] });
    expect(await batchQty(finishedBatchId)).toBe('1.0000');
    expect(await batchQty(tomatilloBatchId)).toBe('6.0000');
    expect(await batchQty(decoyPurchaseBatchId)).toBe('5.0000');
  }, 120_000);
});
