import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, inventoryItems, recipes, recipeItems, unitConversions, salesConsumptionIdentities, salesConsumptionRevisions } from "@/lib/db/schema";
import { buildSaleRecipeSnapshot, saleSnapshotDemand } from "@/lib/services/sale-consumption-snapshot";
import { saleRecipeReader } from "@/lib/services/sale-consumption-reader";
import { nextSaleConsumptionRevision } from "@/lib/services/sale-consumption-contract";
import { provisionRuntimeRole } from "./helpers/runtime-role";

beforeAll(async () => {
  const host = (value: string) => new URL(value).hostname.replace(/-pooler(?=\.)/, "");
  const operational = existsSync(".env") ? parse(readFileSync(".env")).DATABASE_URL : undefined;
  if (operational) expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(operational));
  await provisionRuntimeRole([]);
  await db.execute(sql`DO $$ BEGIN EXECUTE format('GRANT pulso_app TO %I', current_user); END $$`);
});

it("INV-01.b2: lector runtime, subreceta/conversión y JSONB real; fixtures rollback", async () => {
  const company = randomUUID(), other = randomUUID(), branch = randomUUID();
  const dish = randomUUID(), prep = randomUUID(), foreign = randomUUID(), rice = randomUUID(), otherRice = randomUUID();
  await expect(db.transaction(async tx => {
    await tx.insert(companies).values([{ id: company, name: "Snapshot sintético A" }, { id: other, name: "Snapshot sintético B" }]);
    await tx.insert(branches).values({ id: branch, companyId: company, name: "Sucursal sintética snapshot" });
    await tx.insert(inventoryItems).values([{ id: rice, companyId: company, name: "Arroz sintético", unit: "KG" }, { id: otherRice, companyId: other, name: "Arroz ajeno", unit: "G" }]);
    await tx.insert(recipes).values([{ id: dish, companyId: company, name: "Plato sintético", baseYield: "1", unit: "PORTION" },
      { id: prep, companyId: company, name: "Prep sintético", baseYield: "3", unit: "KG" },
      { id: foreign, companyId: other, name: "Receta ajena", baseYield: "1", unit: "KG" }]);
    await tx.insert(recipeItems).values([{ recipeId: dish, itemId: prep, quantity: "1500", unit: "G", isSubRecipe: true, yieldPercent: 50 },
      { recipeId: prep, itemId: rice, quantity: "1", unit: "KG", isSubRecipe: false, yieldPercent: 50 }]);
    // Una conversión de otra empresa no participa ni vuelve ambigua la propia.
    await tx.insert(unitConversions).values([{ companyId: company, fromUnit: "G", toUnit: "KG", factor: "0.001000" },
      { companyId: other, fromUnit: "G", toUnit: "KG", factor: "0.500000" }]);
    await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
    await tx.execute(sql`SELECT set_config('app.current_company_id', '', true), set_config('app.current_branch_id', '', true)`);
    const reader = saleRecipeReader(tx);
    expect(await reader.recipe(dish, company)).toBeNull();
    await tx.execute(sql`SELECT set_config('app.current_company_id', ${company}, true), set_config('app.current_branch_id', ${branch}, true)`);
    expect(await reader.recipe(foreign, company)).toBeNull();
    expect(await reader.recipe(foreign, other)).toBeNull();
    expect(await reader.ingredient(otherRice, company)).toBeNull();
    expect(await reader.ingredient(otherRice, other)).toBeNull();
    expect(await reader.conversions("G", "KG", other)).toEqual([]);
    await expect(buildSaleRecipeSnapshot(company, foreign, reader)).rejects.toThrow();
    const snapshot = await buildSaleRecipeSnapshot(company, dish, reader);
    expect(saleSnapshotDemand(snapshot, "10")).toEqual([{ itemId: rice, unit: "KG", quantity: "20.0000" }]);
    const [identity] = await tx.insert(salesConsumptionIdentities).values({ companyId: company, branchId: branch, source: "pos:test", productKey: "snapshot", saleDay: "2026-11-12" }).returning();
    const [revision] = await tx.insert(salesConsumptionRevisions).values({ identityId: identity.id, companyId: company, branchId: branch,
      ...nextSaleConsumptionRevision(null, "10"), recipeId: dish, recipeSnapshot: snapshot, allocations: [], movementRefs: [], recordedBy: "synthetic-snapshot-test" }).returning();
    expect(saleSnapshotDemand(revision.recipeSnapshot, "10")).toEqual(saleSnapshotDemand(snapshot, "10"));
    await tx.execute(sql.raw("RESET ROLE"));
    await tx.update(recipeItems).set({ quantity: "2" }).where(eq(recipeItems.recipeId, prep));
    await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
    expect(saleSnapshotDemand(revision.recipeSnapshot, "10")[0].quantity).toBe("20.0000");
    expect(saleSnapshotDemand(await buildSaleRecipeSnapshot(company, dish, reader), "10")[0].quantity).toBe("40.0000");
    throw new Error("snapshot rollback esperado");
  })).rejects.toThrow("snapshot rollback esperado");
  expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, company))).toEqual([]);
  expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, other))).toEqual([]);
});
