import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSalesRuntimeDatabase } from "./helpers/sales-runtime-database";

// V2 real PostgreSQL integration test for PROD-01.a:
// Uses a disposable database from baseline 0158 + 0159/0160/0161 migrations,
// two companies / two branches, verifies atomic finished-batch creation,
// INV-02 policy resolution, rollback on shortage, no fictitious stock without
// ingredients, cross-company rejection, and workflow idempotency.
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let ProductionService: typeof import("@/lib/services/production-service").ProductionService;
const originalDatabaseUrl = process.env.DATABASE_URL;

const companyA = randomUUID();
const companyB = randomUUID();
const branchA = randomUUID();
const branchB = randomUUID();
const ingredientId = randomUUID();
const finishedItemA = randomUUID();
const finishedItemB = randomUUID();
const recipeId = randomUUID();
const recipeVersionId = randomUUID();
const ingredientBatchId = randomUUID();
const actorId = randomUUID();

beforeAll(async () => {
  fixture = await createSalesRuntimeDatabase({ baseline: "0158" });
  process.env.DATABASE_URL = fixture.ownerUrl;

  for (const file of [
    "drizzle/0159_inv02_consumption_policy.sql",
    "drizzle/0160_inv02_policy_publication_access.sql",
    "drizzle/0161_prod01a_finished_batch_link.sql",
  ]) {
    for (const statement of readFileSync(file, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await fixture.owner.execute(sql.raw(trimmed.replaceAll("pulso_app", fixture.roleName)));
    }
  }

  ({ ProductionService } = await import("@/lib/services/production-service"));

  await fixture.owner.insert(schema.companies).values([
    { id: companyA, name: "Synthetic PROD-01.a Company A" },
    { id: companyB, name: "Synthetic PROD-01.a Company B" },
  ]);
  await fixture.owner.insert(schema.branches).values([
    { id: branchA, companyId: companyA, name: "Branch A" },
    { id: branchB, companyId: companyB, name: "Branch B" },
  ]);
  await fixture.owner.insert(schema.users).values({
    id: actorId,
    companyId: companyA,
    branchId: branchA,
    role: "ADMIN",
    email: `${actorId}@example.invalid`,
    name: "Synthetic PROD Actor",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await fixture.owner.insert(schema.inventoryItems).values([
    { id: ingredientId, companyId: companyA, name: "Harina", unit: "KG" },
    { id: finishedItemA, companyId: companyA, name: "Masa Madre", unit: "KG" },
    { id: finishedItemB, companyId: companyB, name: "Masa Ajena", unit: "KG" },
  ]);
  await fixture.owner.insert(schema.recipes).values({
    id: recipeId,
    companyId: companyA,
    name: "Receta Masa Madre",
    baseYield: "1",
    unit: "KG",
    holdTimeMinutes: 240,
  });
  await fixture.owner.insert(schema.recipeVersions).values({
    id: recipeVersionId,
    recipeId,
    companyId: companyA,
    versionNumber: 1,
    name: "Receta Masa Madre v1",
    baseYield: "1",
    unit: "KG",
    calculatedCost: 250,
    priceSelling: 0,
    foodCostPercentage: "0",
    itemsSnapshot: [],
    changedBy: actorId,
  });
  await fixture.owner.insert(schema.inventoryBatches).values({
    id: ingredientBatchId,
    itemId: ingredientId,
    branchId: branchA,
    initialQuantity: "10.0000",
    currentQuantity: "10.0000",
    unitCost: 250,
    status: "AVAILABLE",
    expirationDate: new Date("2099-01-01T00:00:00Z"),
  });
}, 150_000);

afterAll(async () => {
  try { await fixture?.close(); }
  finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}, 90_000);

describe("PROD-01.a V2: lote terminado en PostgreSQL real con 0159/0160/0161", () => {
  it("crea lote terminado atómicamente vía política INV-02, rechaza sin insumos/insuficiencia/empresa ajena y es idempotente", async () => {
    const owner = fixture!.owner;

    // 1. Cross-company finishedItemId rejected without touching stock
    await expect(ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      producedQuantity: 2,
      unit: "KG",
      finishedItemId: finishedItemB,
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 2, actualQuantity: 2, unit: "KG" }],
    }, owner)).rejects.toMatchObject({ statusCode: 400 });

    // 2. Zero ingredients rejected (no fictitious stock)
    await expect(ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      producedQuantity: 2,
      unit: "KG",
      finishedItemId: finishedItemA,
      recordedBy: actorId,
      ingredients: [],
    }, owner)).rejects.toMatchObject({ statusCode: 400 });

    // 3. Publish INV-02 FINISHED_PRODUCT_ON_SALE policy
    await owner.insert(schema.recipeConsumptionPolicies).values({
      companyId: companyA,
      recipeId,
      recipeVersionId,
      effectiveFrom: "2026-11-01",
      mode: "FINISHED_PRODUCT_ON_SALE",
      inventoryItemId: finishedItemA,
      unit: "KG",
      publishedBy: actorId,
      reason: "Política V2 PROD-01.a",
    });

    // 4. Insufficient ingredient rolls back entire transaction (0 finished batches, stock still 10)
    await expect(ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      producedQuantity: 5,
      unit: "KG",
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 15, actualQuantity: 15, unit: "KG" }],
    }, owner)).rejects.toMatchObject({ statusCode: 409 });

    expect(await owner.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.itemId, finishedItemA))).toEqual([]);
    expect((await owner.select({ qty: schema.inventoryBatches.currentQuantity }).from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, ingredientBatchId)))[0].qty).toBe("10.0000");

    // 5. Happy path with workflowInstanceId + auto-resolution from INV-02 policy
    const wfId = randomUUID();
    const res = await ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      workflowInstanceId: wfId,
      producedQuantity: 4,
      unit: "KG",
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 4, actualQuantity: 4, unit: "KG" }],
    }, owner);

    expect(res).not.toBeNull();
    expect(res!.ingredientCost).toBe(1000); // 4 KG * 250 cents
    expect(res!.finishedBatchId).toBeTruthy();

    const [finBatch] = await owner.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, res!.finishedBatchId!));
    expect(finBatch).toMatchObject({
      itemId: finishedItemA,
      branchId: branchA,
      initialQuantity: "4.0000",
      currentQuantity: "4.0000",
      unitCost: 250,
      status: "AVAILABLE",
      origin: "PRODUCTION",
      parentBatchIds: [ingredientBatchId],
    });
    expect(finBatch.expirationDate).not.toBeNull();

    const [savedResult] = await owner.select().from(schema.productionResults).where(eq(schema.productionResults.id, res!.id));
    expect(savedResult.finishedBatchId).toBe(finBatch.id);

    // 6. Idempotent replay does not duplicate batch or movements
    const replay = await ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      workflowInstanceId: wfId,
      producedQuantity: 4,
      unit: "KG",
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 4, actualQuantity: 4, unit: "KG" }],
    }, owner);
    expect(replay).toBeNull();

    expect(await owner.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.itemId, finishedItemA))).toHaveLength(1);
    expect((await owner.select({ qty: schema.inventoryBatches.currentQuantity }).from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, ingredientBatchId)))[0].qty).toBe("6.0000");
  }, 60_000);
});
