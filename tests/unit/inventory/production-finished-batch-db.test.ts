import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const { pglite, db } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite: Pg } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle: dr } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  const client = new Pg();
  return { pglite: client, db: dr(client) };
});

vi.mock("@/lib/db", () => ({ db }));

import { ProductionService } from "@/lib/services/production-service";

const companyA = "aaaaaaaa-0000-4000-8000-000000000001";
const companyB = "bbbbbbbb-0000-4000-8000-000000000002";
const branchA = "aaaaaaaa-0000-4000-8000-000000000011";
const ingredientId = "aaaaaaaa-0000-4000-8000-000000000021";
const finishedItemA = "aaaaaaaa-0000-4000-8000-000000000022";
const finishedItemB = "bbbbbbbb-0000-4000-8000-000000000022";
const recipeId = "aaaaaaaa-0000-4000-8000-000000000031";
const recipeVersionId = "aaaaaaaa-0000-4000-8000-000000000032";
const ingredientBatchId = "aaaaaaaa-0000-4000-8000-000000000041";
const orderId = "aaaaaaaa-0000-4000-8000-000000000051";
const actorId = "user-prod-01a";

beforeAll(async () => {
  await pglite.exec(`
    CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid NOT NULL, name text);
    CREATE TABLE recipes (id uuid PRIMARY KEY, company_id uuid NOT NULL, name text, hold_time_minutes integer);
    CREATE TABLE inventory_items (id uuid PRIMARY KEY, company_id uuid NOT NULL, name text, unit text NOT NULL);
    CREATE TABLE unit_conversions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL,
      from_unit text NOT NULL,
      to_unit text NOT NULL,
      factor numeric(12,4) NOT NULL
    );
    CREATE TABLE inventory_batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id uuid NOT NULL,
      branch_id uuid NOT NULL,
      supplier_id uuid,
      lot_number text,
      production_date timestamp,
      expiration_date timestamp,
      received_at timestamp DEFAULT now(),
      initial_quantity numeric(12,4) NOT NULL,
      current_quantity numeric(12,4) NOT NULL,
      unit_cost integer,
      status text DEFAULT 'AVAILABLE',
      supplier_batch_info jsonb,
      origin text,
      parent_batch_ids jsonb,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
    CREATE TABLE inventory_movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      branch_id uuid NOT NULL,
      item_id uuid NOT NULL,
      batch_id uuid,
      type text NOT NULL,
      quantity_change numeric(12,4) NOT NULL,
      from_location_id uuid,
      to_location_id uuid,
      reason text,
      reference_id text,
      performed_by text,
      timestamp timestamp DEFAULT now() NOT NULL
    );
    CREATE TABLE production_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL,
      branch_id uuid NOT NULL,
      recipe_id uuid NOT NULL,
      planned_quantity integer NOT NULL,
      unit text NOT NULL,
      planned_date timestamp NOT NULL,
      status text NOT NULL DEFAULT 'PLANNED',
      completed_at timestamp,
      notes text,
      created_by text NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    );
    CREATE TABLE production_results (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL,
      branch_id uuid NOT NULL,
      order_id uuid,
      recipe_id uuid NOT NULL,
      workflow_instance_id uuid,
      produced_quantity integer NOT NULL,
      unit text NOT NULL DEFAULT 'PORTION',
      expires_at timestamp,
      ingredient_cost integer DEFAULT 0,
      finished_batch_id uuid,
      hold_alert_notified_at timestamp,
      discarded_at timestamp,
      discarded_quantity numeric(12,4),
      discarded_by text,
      notes text,
      recorded_by text NOT NULL,
      production_date timestamp DEFAULT now() NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX production_results_instance_recipe_unique
      ON production_results (workflow_instance_id, recipe_id)
      WHERE workflow_instance_id IS NOT NULL;
    CREATE UNIQUE INDEX production_results_finished_batch_unique
      ON production_results (finished_batch_id)
      WHERE finished_batch_id IS NOT NULL;
    CREATE TABLE production_ingredients (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      result_id uuid NOT NULL,
      item_id uuid NOT NULL,
      batch_id uuid,
      expected_quantity numeric(12,4) NOT NULL,
      actual_quantity numeric(12,4) NOT NULL,
      unit text NOT NULL,
      unit_cost integer,
      total_cost integer,
      yield_percent integer DEFAULT 100,
      created_at timestamp DEFAULT now() NOT NULL
    );
    CREATE TABLE recipe_consumption_policies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL,
      recipe_id uuid NOT NULL,
      recipe_version_id uuid NOT NULL,
      effective_from date NOT NULL,
      mode text NOT NULL,
      inventory_item_id uuid,
      unit text,
      published_by text NOT NULL,
      reason text NOT NULL,
      published_at timestamp DEFAULT now() NOT NULL
    );
  `);
});

afterAll(async () => { await pglite.close(); });

beforeEach(async () => {
  await pglite.exec(`
    TRUNCATE recipe_consumption_policies, production_ingredients, production_results,
      production_orders, inventory_movements, inventory_batches, unit_conversions,
      inventory_items, recipes, branches;
  `);
  await db.execute(sql`INSERT INTO branches (id, company_id, name) VALUES (${branchA}, ${companyA}, 'Sucursal A')`);
  await db.execute(sql`INSERT INTO recipes (id, company_id, name, hold_time_minutes) VALUES (${recipeId}, ${companyA}, 'Salsa Madre', 120)`);
  await db.execute(sql`INSERT INTO inventory_items (id, company_id, name, unit) VALUES
    (${ingredientId}, ${companyA}, 'Tomate', 'KG'),
    (${finishedItemA}, ${companyA}, 'Salsa Madre (Terminado)', 'L'),
    (${finishedItemB}, ${companyB}, 'Salsa Ajena', 'L')`);
  await db.execute(sql`INSERT INTO unit_conversions (company_id, from_unit, to_unit, factor) VALUES (${companyA}, 'PORTION', 'L', 0.5000)`);
  await db.insert(schema.inventoryBatches).values({
    id: ingredientBatchId,
    itemId: ingredientId,
    branchId: branchA,
    initialQuantity: "10.0000",
    currentQuantity: "10.0000",
    unitCost: 300, // 300 cents / KG
    status: "AVAILABLE",
    expirationDate: new Date("2099-01-01T00:00:00Z"),
  });
  await db.execute(sql`INSERT INTO production_orders (id, company_id, branch_id, recipe_id, planned_quantity, unit, planned_date, status, created_by)
    VALUES (${orderId}, ${companyA}, ${branchA}, ${recipeId}, 4, 'PORTION', '2026-11-22T00:00:00Z'::timestamp, 'PLANNED', ${actorId})`);
});

describe("PROD-01.a: creación atómica de lote de producto terminado", () => {
  it("crea lote terminado con cantidad convertida, costo exacto, caducidad, genealogía y vínculo 1:1 en la misma transacción", async () => {
    const result = await ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      orderId,
      recipeId,
      producedQuantity: 4, // 4 PORTION * 0.5 L/PORTION = 2.0000 L
      unit: "PORTION",
      finishedItemId: finishedItemA,
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 3, actualQuantity: 3, unit: "KG" }],
    });

    expect(result).not.toBeNull();
    expect(result!.ingredientCost).toBe(900); // 3 KG * 300 cents
    expect(result!.finishedBatchId).toBeTruthy();

    // Ingredient batch deducted
    const [ingBatch] = await db.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, ingredientBatchId));
    expect(ingBatch.currentQuantity).toBe("7.0000");

    // Finished batch created with converted qty, unitCost = 900 / 2 = 450 cents/L, origin = PRODUCTION, parentBatchIds
    const [finBatch] = await db.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, result!.finishedBatchId!));
    expect(finBatch.itemId).toBe(finishedItemA);
    expect(finBatch.branchId).toBe(branchA);
    expect(finBatch.initialQuantity).toBe("2.0000");
    expect(finBatch.currentQuantity).toBe("2.0000");
    expect(finBatch.unitCost).toBe(450);
    expect(finBatch.status).toBe("AVAILABLE");
    expect(finBatch.origin).toBe("PRODUCTION");
    expect(finBatch.parentBatchIds).toEqual([ingredientBatchId]);
    expect(finBatch.expirationDate).not.toBeNull();

    // production_results linked to finishedBatchId
    const [savedResult] = await db.select().from(schema.productionResults).where(eq(schema.productionResults.id, result!.id));
    expect(savedResult.finishedBatchId).toBe(finBatch.id);

    // Movements: 1 USAGE (-3) + 1 RECEIVING (+2)
    const moves = await db.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.referenceId, result!.id));
    expect(moves).toHaveLength(2);
    expect(moves.find(m => m.type === "USAGE")).toMatchObject({ itemId: ingredientId, batchId: ingredientBatchId, quantityChange: "-3.0000" });
    expect(moves.find(m => m.type === "RECEIVING")).toMatchObject({ itemId: finishedItemA, batchId: finBatch.id, quantityChange: "2.0000" });

    // Order closed
    const [order] = await db.select({ status: schema.productionOrders.status }).from(schema.productionOrders).where(eq(schema.productionOrders.id, orderId));
    expect(order.status).toBe("COMPLETED");
  });

  it("resuelve automáticamente el artículo terminado desde la política INV-02 vigente y rechaza divergencia explícita", async () => {
    await db.insert(schema.recipeConsumptionPolicies).values({
      companyId: companyA,
      recipeId,
      recipeVersionId,
      effectiveFrom: "2026-11-01",
      mode: "FINISHED_PRODUCT_ON_SALE",
      inventoryItemId: finishedItemA,
      unit: "L",
      publishedBy: actorId,
      reason: "Política de prueba",
    });

    // Divergent explicit finishedItemId rejected without touching stock
    await expect(ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      producedQuantity: 2,
      unit: "L",
      finishedItemId: ingredientId,
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 1, actualQuantity: 1, unit: "KG" }],
    })).rejects.toMatchObject({ statusCode: 400 });

    const [unchanged] = await db.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, ingredientBatchId));
    expect(unchanged.currentQuantity).toBe("10.0000");

    // Without explicit finishedItemId, resolves from policy automatically
    const result = await ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      producedQuantity: 2,
      unit: "L",
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 2, actualQuantity: 2, unit: "KG" }],
    });
    expect(result!.finishedBatchId).toBeTruthy();
    const [finBatch] = await db.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, result!.finishedBatchId!));
    expect(finBatch.itemId).toBe(finishedItemA);
    expect(finBatch.currentQuantity).toBe("2.0000");
    expect(finBatch.unitCost).toBe(300); // 600 cents / 2 L
  });

  it("sin insumos consumidos rechaza la producción y no crea stock terminado ficticio", async () => {
    await expect(ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      producedQuantity: 4,
      unit: "L",
      finishedItemId: finishedItemA,
      recordedBy: actorId,
      ingredients: [],
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      producedQuantity: 4,
      unit: "L",
      finishedItemId: finishedItemA,
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 1, actualQuantity: 0, unit: "KG" }],
    })).rejects.toMatchObject({ statusCode: 400 });

    const batches = await db.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.itemId, finishedItemA));
    expect(batches).toEqual([]);
    const results = await db.select().from(schema.productionResults);
    expect(results).toEqual([]);
  });

  it("insuficiencia de ingredientes revierte todo y no deja lote terminado ni resultado", async () => {
    await expect(ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      orderId,
      recipeId,
      producedQuantity: 4,
      unit: "L",
      finishedItemId: finishedItemA,
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 15, actualQuantity: 15, unit: "KG" }],
    })).rejects.toMatchObject({ statusCode: 409 });

    const [ingBatch] = await db.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, ingredientBatchId));
    expect(ingBatch.currentQuantity).toBe("10.0000");
    expect(await db.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.itemId, finishedItemA))).toEqual([]);
    expect(await db.select().from(schema.productionResults)).toEqual([]);
    expect(await db.select().from(schema.inventoryMovements)).toEqual([]);
    const [order] = await db.select({ status: schema.productionOrders.status }).from(schema.productionOrders).where(eq(schema.productionOrders.id, orderId));
    expect(order.status).toBe("PLANNED");
  });

  it("rechaza artículo terminado de otra empresa sin descontar insumos y reintento de workflow no duplica lote", async () => {
    await expect(ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      producedQuantity: 2,
      unit: "L",
      finishedItemId: finishedItemB,
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 1, actualQuantity: 1, unit: "KG" }],
    })).rejects.toMatchObject({ statusCode: 400 });

    const wfId = "aaaaaaaa-0000-4000-8000-000000000099";
    const first = await ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      workflowInstanceId: wfId,
      producedQuantity: 2,
      unit: "L",
      finishedItemId: finishedItemA,
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 2, actualQuantity: 2, unit: "KG" }],
    });
    expect(first?.finishedBatchId).toBeTruthy();

    const replay = await ProductionService.recordProduction({
      companyId: companyA,
      branchId: branchA,
      recipeId,
      workflowInstanceId: wfId,
      producedQuantity: 2,
      unit: "L",
      finishedItemId: finishedItemA,
      recordedBy: actorId,
      ingredients: [{ itemId: ingredientId, expectedQuantity: 2, actualQuantity: 2, unit: "KG" }],
    });
    expect(replay).toBeNull();

    const finBatches = await db.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.itemId, finishedItemA));
    expect(finBatches).toHaveLength(1);
    const [ingBatch] = await db.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, ingredientBatchId));
    expect(ingBatch.currentQuantity).toBe("8.0000");
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM inventory_movements WHERE item_id = ${finishedItemA}`)).rows[0].n).toBe(1);
  });
});
