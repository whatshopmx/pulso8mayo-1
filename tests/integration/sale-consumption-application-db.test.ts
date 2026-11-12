import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, inventoryItems, inventoryBatches, inventoryMovements, recipes, recipeItems, salesEntries, salesConsumptionIdentities, salesConsumptionRevisions } from "@/lib/db/schema";
import { applySaleConsumptionInTransaction } from "@/lib/services/sale-consumption-service";
import { buildSaleRecipeSnapshot } from "@/lib/services/sale-consumption-snapshot";
import { saleRecipeReader } from "@/lib/services/sale-consumption-reader";
import { provisionRuntimeRole } from "./helpers/runtime-role";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture = { company: string[]; branch: string[]; item: string[]; recipe: string[]; batch: string[] };
async function probe(check: (tx: Tx, f: Fixture) => Promise<void>) {
  const ids = (count: number) => Array.from({ length: count }, () => randomUUID());
  const f: Fixture = { company: ids(2), branch: ids(3), item: ids(3), recipe: ids(3), batch: ids(4) };
  await db.transaction(async tx => {
    await tx.insert(companies).values(f.company.map(id => ({ id, name: "Aplicación sintética" })));
    await tx.insert(branches).values(f.branch.map((id, i) => ({ id, companyId: f.company[i === 2 ? 1 : 0], name: "Sucursal aplicación" })));
    await tx.insert(inventoryItems).values(f.item.map((id, i) => ({ id, companyId: f.company[i === 2 ? 1 : 0], name: "Ingrediente aplicación", unit: "KG" })));
    await tx.insert(recipes).values(f.recipe.map((id, i) => ({ id, companyId: f.company[i === 2 ? 1 : 0], name: "Receta aplicación", baseYield: "1", unit: "PORTION" })));
    await tx.insert(recipeItems).values(f.recipe.map((id, i) => ({ recipeId: id, itemId: f.item[i], quantity: "1", unit: "KG", yieldPercent: 100 })));
    await tx.insert(inventoryBatches).values(f.batch.map((id, i) => ({ id, itemId: f.item[i < 2 ? 0 : i === 2 ? 1 : 2], branchId: f.branch[i === 3 ? 2 : 0], initialQuantity: i === 0 ? "6" : i === 1 ? "14" : "20", currentQuantity: i === 0 ? "6" : i === 1 ? "14" : "20", status: "AVAILABLE" as const, expirationDate: new Date(i === 0 ? "2098-01-01" : "2099-01-01"), receivedAt: new Date("2026-01-01") })));
    await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
    await check(tx, f);
    throw new Error("application rollback esperado");
  }, { isolationLevel: "serializable" }).catch(error => {
    if (!(error instanceof Error) || error.message !== "application rollback esperado") throw error;
  });
  for (const id of f.company) expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
}
function input(f: Fixture, quantitySold = "10", totalRevenueCents = 1000) {
  return { companyId: f.company[0], branchId: f.branch[0], source: "pos:test", productKey: "SKU-1", saleDay: "2026-11-12", recipeId: f.recipe[0], quantitySold, totalRevenueCents, userId: "synthetic-application" };
}
async function stocks(tx: Tx) {
  return tx.select({ id: inventoryBatches.id, quantity: inventoryBatches.currentQuantity }).from(inventoryBatches).orderBy(inventoryBatches.id);
}
async function failed(tx: Tx, expectedCode: string, action: () => Promise<unknown>) {
  await tx.execute(sql.raw("SAVEPOINT failed_application"));
  let failure: { code?: string; cause?: { code?: string } } | undefined;
  try { await action(); } catch (error) { failure = error as typeof failure; }
  await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT failed_application"));
  expect(failure?.cause?.code ?? failure?.code).toBe(expectedCode);
}

describe("INV-01.b3: aplicación atómica real con runtime", () => {
  beforeAll(async () => {
    const host = (value: string) => new URL(value).hostname.replace(/-pooler(?=\.)/, "");
    const operational = existsSync(".env") ? parse(readFileSync(".env")).DATABASE_URL : undefined;
    if (operational) expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(operational));
    await provisionRuntimeRole([]);
    await db.execute(sql`DO $$ BEGIN EXECUTE format('GRANT pulso_app TO %I', current_user); END $$`);
  });
  it("10→12 descuenta solo 2; 12→8 devuelve 4; repetir no mueve stock; anular devuelve a lotes originales", async () => {
    await probe(async (tx, f) => {
      const first = await applySaleConsumptionInTransaction(tx, input(f));
      expect(first).toMatchObject({ applied: true, revision: 1 });
      const beforeRetry = await stocks(tx);
      expect(beforeRetry.find(row => row.id === f.batch[0])?.quantity).toBe("0.0000");
      expect(beforeRetry.find(row => row.id === f.batch[1])?.quantity).toBe("10.0000");
      expect(await applySaleConsumptionInTransaction(tx, input(f))).toMatchObject({ applied: false, revision: 1 });
      expect(await stocks(tx)).toEqual(beforeRetry);
      await applySaleConsumptionInTransaction(tx, input(f, "12", 1200));
      expect((await stocks(tx)).find(row => row.id === f.batch[1])?.quantity).toBe("8.0000");
      expect((await tx.select().from(salesConsumptionRevisions)).find(row => row.revision === 2)?.movementRefs.map(row => row.quantityChange)).toEqual(["-2.0000"]);
      await applySaleConsumptionInTransaction(tx, input(f, "8", 800));
      const rows = await tx.select({ id: inventoryBatches.id, quantity: inventoryBatches.currentQuantity }).from(inventoryBatches);
      expect(rows.find(row => row.id === f.batch[0])?.quantity).toBe("0.0000");
      expect(rows.find(row => row.id === f.batch[1])?.quantity).toBe("12.0000");
      expect((await tx.select().from(salesEntries))[0]).toMatchObject({ quantitySold: "8.00", totalRevenue: 800 });
      const head = (await tx.select().from(salesConsumptionRevisions)).find(row => row.revision === 3)!;
      expect(head.totalRevenue).toBe(800);
      expect(head.movementRefs.filter(row => row.reversesMovementId).map(row => row.quantityChange).sort()).toEqual(["2.0000", "2.0000"]);
      const count = (await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)).length;
      expect(await applySaleConsumptionInTransaction(tx, input(f, "8", 800))).toMatchObject({ applied: false, revision: 3 });
      expect(await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)).toHaveLength(count);
      await applySaleConsumptionInTransaction(tx, input(f, "0", 0));
      const restored = await stocks(tx);
      expect(restored.find(row => row.id === f.batch[0])?.quantity).toBe("6.0000");
      expect(restored.find(row => row.id === f.batch[1])?.quantity).toBe("14.0000");
      expect((await tx.select().from(salesConsumptionRevisions)).find(row => row.revision === 4)?.allocations).toEqual([]);
    });
  });
  it("cambiar receta devuelve al lote original incluso vencido y actualiza ambas proyecciones", async () => {
    await probe(async (tx, f) => {
      await applySaleConsumptionInTransaction(tx, input(f, "3", 300));
      await tx.execute(sql.raw("RESET ROLE"));
      await tx.update(inventoryBatches).set({ expirationDate: new Date("2000-01-01") }).where(eq(inventoryBatches.id, f.batch[0]));
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await applySaleConsumptionInTransaction(tx, { ...input(f, "3", 300), recipeId: f.recipe[1] });
      const rows = await stocks(tx);
      expect(rows.find(row => row.id === f.batch[0])?.quantity).toBe("6.0000");
      expect(rows.find(row => row.id === f.batch[2])?.quantity).toBe("17.0000");
      const sales = await tx.select().from(salesEntries);
      expect(sales.find(row => row.recipeId === f.recipe[0])).toMatchObject({ quantitySold: "0.00", totalRevenue: 0 });
      expect(sales.find(row => row.recipeId === f.recipe[1])).toMatchObject({ quantitySold: "3.00", totalRevenue: 300 });
      const head = (await tx.select().from(salesConsumptionRevisions)).find(row => row.revision === 2)!;
      expect(head.movementRefs.some(row => row.reversesMovementId && row.batchId === f.batch[0])).toBe(true);
      expect(head.allocations.every(row => row.itemId === f.item[1])).toBe(true);
    });
  });
  it("conserva otros productos/fuentes de la misma receta al corregir un solo origen", async () => {
    await probe(async (tx, f) => {
      await applySaleConsumptionInTransaction(tx, input(f, "4", 400));
      await applySaleConsumptionInTransaction(tx, { ...input(f, "3", 300), productKey: "SKU-2" });
      await applySaleConsumptionInTransaction(tx, { ...input(f, "2", 200), source: "pos:other" });
      await applySaleConsumptionInTransaction(tx, input(f, "5", 500));
      expect((await tx.select().from(salesEntries))[0]).toMatchObject({ quantitySold: "10.00", totalRevenue: 1000 });
      expect(await tx.select().from(salesConsumptionIdentities)).toHaveLength(3);
      await applySaleConsumptionInTransaction(tx, { ...input(f, "5", 500), recipeId: f.recipe[1] });
      const sales = await tx.select().from(salesEntries);
      expect(sales.find(row => row.recipeId === f.recipe[0])).toMatchObject({ quantitySold: "5.00", totalRevenue: 500 });
      expect(sales.find(row => row.recipeId === f.recipe[1])).toMatchObject({ quantitySold: "5.00", totalRevenue: 500 });
    });
  });
  it("una corrección monetaria no mueve stock; conserva definición anterior hasta rebase explícito", async () => {
    await probe(async (tx, f) => {
      await applySaleConsumptionInTransaction(tx, input(f, "4", 400));
      const original = await stocks(tx);
      await applySaleConsumptionInTransaction(tx, input(f, "4", 450));
      expect(await stocks(tx)).toEqual(original);
      expect((await tx.select().from(salesConsumptionRevisions)).find(row => row.revision === 2)?.movementRefs).toEqual([]);
      await tx.execute(sql.raw("RESET ROLE"));
      await tx.update(recipeItems).set({ quantity: "2" }).where(eq(recipeItems.recipeId, f.recipe[0]));
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await applySaleConsumptionInTransaction(tx, input(f, "6", 600));
      let rows = await stocks(tx);
      const remaining = () => rows.filter(row => f.batch.slice(0, 2).includes(row.id)).reduce((sum, row) => sum + Number(row.quantity), 0);
      expect(remaining()).toBe(14); // Seis porciones con la definición original 1 KG.
      const snapshot = await buildSaleRecipeSnapshot(f.company[0], f.recipe[0], saleRecipeReader(tx));
      await applySaleConsumptionInTransaction(tx, { ...input(f, "6", 600), recipeVersionKey: snapshot.versionKey });
      rows = await stocks(tx);
      expect(remaining()).toBe(8); // Rebase explícito: seis porciones de 2 KG.
      const count = (await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)).length;
      expect(await applySaleConsumptionInTransaction(tx, { ...input(f, "6", 600), recipeVersionKey: snapshot.versionKey })).toMatchObject({ applied: false });
      expect(await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)).toHaveLength(count);
    });
  });
  it("stock insuficiente revierte también las devoluciones hechas antes del faltante", async () => {
    await probe(async (tx, f) => {
      await applySaleConsumptionInTransaction(tx, input(f));
      const before = await stocks(tx);
      const count = (await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)).length;
      await failed(tx, "INSUFFICIENT_STOCK", () => applySaleConsumptionInTransaction(tx, { ...input(f, "25", 2500), recipeId: f.recipe[1] }));
      expect(await stocks(tx)).toEqual(before);
      expect(await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)).toHaveLength(count);
      expect(await tx.select().from(salesConsumptionRevisions)).toHaveLength(1);
      expect((await tx.select().from(salesEntries))[0]).toMatchObject({ quantitySold: "10.00", totalRevenue: 1000 });
    });
  });
  it("un error capturado por el llamador tampoco puede dejar media revisión en su transacción", async () => {
    await probe(async (tx, f) => {
      await applySaleConsumptionInTransaction(tx, input(f));
      const before = await stocks(tx);
      let failure: unknown;
      try { await applySaleConsumptionInTransaction(tx, { ...input(f, "25", 2500), recipeId: f.recipe[1] }); }
      catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: "INSUFFICIENT_STOCK" });
      // Sin SAVEPOINT del test: la API transaccional debe revertir su unidad.
      expect(await stocks(tx)).toEqual(before);
      expect(await tx.select().from(salesConsumptionRevisions)).toHaveLength(1);
    });
  });
  it("un fallo de revisión después de proyectar venta revierte stock, movimientos, venta e identidad", async () => {
    await probe(async (tx, f) => {
      const name = `sale_failure_${randomUUID().replace(/-/g, "")}`;
      await tx.execute(sql.raw("RESET ROLE"));
      await tx.execute(sql`CREATE FUNCTION public.${sql.identifier(name)}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.recorded_by='synthetic-failure' THEN RAISE EXCEPTION 'synthetic failure after projection' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$`);
      await tx.execute(sql`CREATE TRIGGER ${sql.identifier(name)} BEFORE INSERT ON public.sales_consumption_revisions FOR EACH ROW EXECUTE FUNCTION public.${sql.identifier(name)}()`);
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${f.company[0]}, true), set_config('app.current_branch_id', ${f.branch[0]}, true)`);
      const before = await stocks(tx);
      await failed(tx, "P0001", () => applySaleConsumptionInTransaction(tx, { ...input(f), userId: "synthetic-failure" }));
      expect(await stocks(tx)).toEqual(before);
      expect(await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)).toEqual([]);
      expect(await tx.select().from(salesEntries)).toEqual([]);
      expect(await tx.select().from(salesConsumptionIdentities)).toEqual([]);
      expect(await tx.select().from(salesConsumptionRevisions)).toEqual([]);
    });
  });
  it("deniega revisión obsoleta, receta ajena y sucursal de otra empresa", async () => {
    await probe(async (tx, f) => {
      await applySaleConsumptionInTransaction(tx, input(f));
      const before = await stocks(tx);
      await failed(tx, "REVISION_CONFLICT", () => applySaleConsumptionInTransaction(tx, { ...input(f, "12", 1200), expectedRevision: 99 }));
      await failed(tx, "INVALID_SCOPE", () => applySaleConsumptionInTransaction(tx, { ...input(f), branchId: f.branch[2] }));
      await tx.execute(sql.raw("SAVEPOINT foreign_recipe"));
      await expect(applySaleConsumptionInTransaction(tx, { ...input(f), recipeId: f.recipe[2] })).rejects.toThrow(/otra empresa|inexistente/i);
      await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT foreign_recipe"));
      expect(await stocks(tx)).toEqual(before);
      expect(await tx.select().from(salesConsumptionRevisions)).toHaveLength(1);
    });
  });
  it("no adopta una venta legacy sin consumo ni una procedencia alterada", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("RESET ROLE"));
      const [legacy] = await tx.insert(salesEntries).values({ companyId: f.company[0], branchId: f.branch[0], recipeId: f.recipe[0], quantitySold: "1", totalRevenue: 100, saleDate: new Date("2026-11-12T00:00:00Z") }).returning();
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await failed(tx, "PENDING_RECOVERY", () => applySaleConsumptionInTransaction(tx, input(f)));
      await tx.execute(sql.raw("RESET ROLE"));
      await tx.delete(salesEntries).where(eq(salesEntries.id, legacy.id)); // Solo fixture, nunca recuperación del servicio.
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await applySaleConsumptionInTransaction(tx, input(f, "4", 400));
      const before = await stocks(tx);
      await tx.execute(sql.raw("RESET ROLE"));
      await tx.update(inventoryMovements).set({ quantityChange: "-3" }).where(eq(inventoryMovements.batchId, f.batch[0]));
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await failed(tx, "PENDING_RECOVERY", () => applySaleConsumptionInTransaction(tx, input(f, "5", 500)));
      expect(await stocks(tx)).toEqual(before);
      expect(await tx.select().from(salesConsumptionRevisions)).toHaveLength(1);
    });
  });
  it("no transforma ingreso histórico desconocido en cero ni descuenta otra vez", async () => {
    await probe(async (tx, f) => {
      const data = input(f, "1", 100);
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${f.company[0]}, true), set_config('app.current_branch_id', ${f.branch[0]}, true)`);
      const snapshot = await buildSaleRecipeSnapshot(f.company[0], f.recipe[0], saleRecipeReader(tx));
      const [identity] = await tx.insert(salesConsumptionIdentities).values({ companyId: data.companyId, branchId: data.branchId, source: data.source, productKey: data.productKey, saleDay: data.saleDay }).returning();
      await tx.insert(salesConsumptionRevisions).values({ identityId: identity.id, companyId: data.companyId, branchId: data.branchId, revision: 1, previousRevision: null, previousQuantitySold: "0", quantitySold: "1", totalRevenue: null, recipeId: data.recipeId, recipeSnapshot: snapshot, allocations: [], movementRefs: [], recordedBy: data.userId });
      const before = await stocks(tx);
      await failed(tx, "PENDING_RECOVERY", () => applySaleConsumptionInTransaction(tx, input(f, "2", 200)));
      expect(await stocks(tx)).toEqual(before);
      expect(await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)).toEqual([]);
      expect((await tx.select().from(salesConsumptionRevisions))[0].totalRevenue).toBeNull();
    });
  });
  it("rechaza precisión/ingreso/versión inválidos y revierte desbordamiento de ingreso agregado", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${f.company[0]}, true), set_config('app.current_branch_id', ${f.branch[0]}, true)`);
      const before = await stocks(tx);
      for (const change of [{ quantitySold: "1.001" }, { totalRevenueCents: -1 }, { expectedRevision: 0 }, { source: "" }, { recipeId: "bad" }]) {
        await failed(tx, "INVALID_INPUT", () => applySaleConsumptionInTransaction(tx, { ...input(f), ...change }));
      }
      expect(await stocks(tx)).toEqual(before);
      expect(await tx.select().from(salesConsumptionIdentities)).toEqual([]);
      await applySaleConsumptionInTransaction(tx, input(f, "1", 2147483647));
      const applied = await stocks(tx);
      await failed(tx, "INVALID_INPUT", () => applySaleConsumptionInTransaction(tx, { ...input(f, "1", 1), productKey: "overflow" }));
      expect(await stocks(tx)).toEqual(applied);
      expect(await tx.select().from(salesConsumptionIdentities)).toHaveLength(1);
      expect((await tx.select().from(salesEntries))[0].totalRevenue).toBe(2147483647);
    });
  });
  it("exige snapshot serializable antes de leer o escribir datos de venta", async () => {
    const data = { companyId: randomUUID(), branchId: randomUUID(), source: "pos:test", productKey: "guard", saleDay: "2026-11-12", recipeId: randomUUID(), quantitySold: "1", totalRevenueCents: 100, userId: "synthetic-application" };
    await expect(db.transaction(tx => applySaleConsumptionInTransaction(tx, data), { isolationLevel: "read committed" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
