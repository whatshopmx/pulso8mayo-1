import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, recipes, salesConsumptionIdentities as identities, salesConsumptionRevisions as revisions } from "@/lib/db/schema";
import { nextSaleConsumptionRevision, type SaleRecipeSnapshot } from "@/lib/services/sale-consumption-contract";
import { provisionRuntimeRole } from "./helpers/runtime-role";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture = { company: string[]; branch: string[]; recipe: string[] };
const key = { source: "pos:test", productKey: "SKU-42", saleDay: "2026-11-11" };
async function context(tx: Tx, company: string, branch = "") {
  await tx.execute(sql`SELECT set_config('app.current_company_id', ${company}, true), set_config('app.current_branch_id', ${branch}, true)`);
}
async function rejected(tx: Tx, code: string, action: () => Promise<unknown>) {
  await tx.execute(sql.raw("SAVEPOINT expected_rejection"));
  let actual: string | undefined;
  try { await action(); } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    actual = failure.cause?.code || failure.code;
  }
  await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT expected_rejection"));
  expect(actual).toBe(code);
}
function snapshot(recipeId: string): SaleRecipeSnapshot {
  return { schemaVersion: 1, recipeId, versionKey: "fixture-v1", definition: { baseYield: "1.00", items: [{ itemId: randomUUID(), quantity: "0.1000", unit: "KG" }] } };
}
async function addIdentity(tx: Tx, f: Fixture, extra: Partial<typeof identities.$inferInsert> = {}) {
  return (await tx.insert(identities).values({ ...key, companyId: f.company[0], branchId: f.branch[0], ...extra }).returning())[0];
}
function revisionValues(f: Fixture, identityId: string, previous: { revision: number; quantitySold: string } | null = null, quantity = "10") {
  return { identityId, companyId: f.company[0], branchId: f.branch[0], ...nextSaleConsumptionRevision(previous, quantity), recipeId: f.recipe[0], recipeSnapshot: snapshot(f.recipe[0]), allocations: [], movementRefs: [], recordedBy: "synthetic-test" };
}
async function probe(check: (tx: Tx, f: Fixture) => Promise<void>) {
  const f: Fixture = { company: [randomUUID(), randomUUID()], branch: Array.from({ length: 3 }, () => randomUUID()), recipe: Array.from({ length: 3 }, () => randomUUID()) };
  await expect(db.transaction(async tx => {
    await tx.insert(companies).values(f.company.map(id => ({ id, name: "INV01A sintética" })));
    await tx.insert(branches).values(f.branch.map((id, i) => ({ id, companyId: f.company[i === 2 ? 1 : 0], name: "INV01A sucursal" })));
    await tx.insert(recipes).values(f.recipe.map((id, i) => ({ id, companyId: f.company[i === 1 ? 1 : 0], name: "INV01A receta", baseYield: "1.00" })));
    await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
    await context(tx, f.company[0], f.branch[0]);
    await check(tx, f);
    throw new Error("INV01A rollback esperado");
  })).rejects.toThrow("INV01A rollback esperado");
  expect(await db.select({ id: identities.id }).from(identities).where(inArray(identities.companyId, f.company))).toHaveLength(0);
  expect(await db.select({ id: companies.id }).from(companies).where(inArray(companies.id, f.company))).toHaveLength(0);
}

describe("INV-01.a2: identidad y revisión persistidas con rol runtime", () => {
  beforeAll(async () => {
    // No fijar un endpoint privado en la suite; separar incluso roles globales
    // del servidor operativo, normalizando la variante pooled de Neon.
    const server = (value: string) => {
      try { const url = new URL(value); return `${url.hostname.replace(/-pooler(?=\.)/, "")}:${url.port || "5432"}`; }
      catch { throw new Error("URL de prueba/operación inválida; se omiten credenciales"); }
    };
    const isolated = server(process.env.TEST_DATABASE_URL!);
    const operational = existsSync(".env") ? parse(readFileSync(".env")).DATABASE_URL : undefined;
    if (operational) expect(isolated).not.toBe(server(operational));
    // No ampliar DML del rol: las concesiones que se prueban proceden de 0137.
    await provisionRuntimeRole([]);
    await db.execute(sql`DO $$ BEGIN EXECUTE format('GRANT pulso_app TO %I', current_user); END $$`);
  });

  it("habilita FORCE RLS y usa un rol que no es dueño ni tiene bypass", async () => {
    await probe(async tx => {
      const result = await tx.execute(sql`SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
        r.rolbypassrls, r.rolsuper, pg_get_userbyid(c.relowner) AS owner FROM pg_class c CROSS JOIN pg_roles r
        WHERE c.relname IN ('sales_consumption_identities','sales_consumption_revisions') AND r.rolname=current_user`);
      expect(result.rows).toHaveLength(2);
      for (const row of result.rows) {
        expect(row).toMatchObject({ rls: true, force: true, rolbypassrls: false, rolsuper: false });
        expect(row.owner).not.toBe("pulso_app");
      }
      const privileges = await tx.execute(sql`SELECT has_table_privilege(current_user, 'public.sales_consumption_revisions', 'INSERT') AS insert,
        has_table_privilege(current_user, 'public.sales_consumption_revisions', 'UPDATE') AS update,
        has_table_privilege(current_user, 'public.sales_consumption_revisions', 'DELETE') AS delete`);
      expect(privileges.rows[0]).toEqual({ insert: true, update: false, delete: false });
    });
  });
  it("repetir la identidad no la duplica; distingue las cinco dimensiones", async () => {
    await probe(async (tx, f) => {
      await addIdentity(tx, f);
      await rejected(tx, "23505", () => addIdentity(tx, f));
      await addIdentity(tx, f, { source: "pos:other" });
      await addIdentity(tx, f, { productKey: "sku-42" });
      await addIdentity(tx, f, { saleDay: "2026-11-12" });
      await context(tx, f.company[0]);
      await addIdentity(tx, f, { branchId: f.branch[1] });
      expect(await tx.select().from(identities)).toHaveLength(5);
      await context(tx, f.company[1], f.branch[2]);
      await addIdentity(tx, f, { companyId: f.company[1], branchId: f.branch[2] });
      expect(await tx.select().from(identities)).toHaveLength(1);
    });
  });
  it("sin contexto o con sucursal ajena no lee/escribe; limita también sucursales propias", async () => {
    await probe(async (tx, f) => {
      await addIdentity(tx, f);
      await rejected(tx, "42501", () => addIdentity(tx, f, { branchId: f.branch[1] }));
      await rejected(tx, "42501", () => addIdentity(tx, f, { branchId: f.branch[2] }));
      await context(tx, f.company[0]);
      await rejected(tx, "42501", () => addIdentity(tx, f, { branchId: f.branch[2] }));
      await addIdentity(tx, f, { branchId: f.branch[1] });
      await context(tx, f.company[0], f.branch[0]);
      expect(await tx.select().from(identities)).toHaveLength(1);
      await context(tx, f.company[1]);
      expect(await tx.select().from(identities)).toHaveLength(0);
      await context(tx, "");
      expect(await tx.select().from(identities)).toHaveLength(0);
      await rejected(tx, "42501", () => addIdentity(tx, f, { productKey: "missing-scope" }));
    });
  });
  it("reconstruye cantidades 10→12→8→0 y conserva las asignaciones originales", async () => {
    await probe(async (tx, f) => {
      const identity = await addIdentity(tx, f);
      const allocation = { itemId: randomUUID(), batchId: randomUUID(), movementId: randomUUID(), remainingQuantity: "1.0000", unit: "KG" };
      const extra = { ...allocation, movementId: randomUUID(), remainingQuantity: "0.2000" };
      const frozenRecipe: SaleRecipeSnapshot = { schemaVersion: 1, recipeId: f.recipe[0], versionKey: "fixture-v1", definition: { baseYield: "1.00", items: [{ itemId: allocation.itemId, quantity: "0.1000", unit: "KG", yieldPercent: 100, isSubRecipe: false }] } };
      const move = (quantityChange: string, reversesMovementId: string | null, movementId = randomUUID()) => ({ movementId, itemId: allocation.itemId, batchId: allocation.batchId, unit: allocation.unit, quantityChange, reversesMovementId });
      // Oráculo manual: 0.1 KG/porción, separado del constructor de revisiones.
      const cases = [
        { quantity: "10", allocations: [allocation], movementRefs: [move("-1.0000", null, allocation.movementId)] },
        { quantity: "12", allocations: [allocation, extra], movementRefs: [move("-0.2000", null, extra.movementId)] },
        { quantity: "8", allocations: [{ ...allocation, remainingQuantity: "0.8000" }], movementRefs: [move("0.2000", extra.movementId), move("0.2000", allocation.movementId)] },
        { quantity: "0", allocations: [], movementRefs: [move("0.8000", allocation.movementId)] },
      ];
      let previous: { revision: number; quantitySold: string } | null = null;
      for (const entry of cases) {
        const values = revisionValues(f, identity.id, previous, entry.quantity);
        previous = (await tx.insert(revisions).values({ ...values, recipeSnapshot: frozenRecipe, allocations: entry.allocations, movementRefs: entry.movementRefs }).returning())[0];
      }
      const rows = await tx.select().from(revisions).orderBy(revisions.revision);
      expect(rows.map(row => [row.previousQuantitySold, row.quantitySold])).toEqual([["0.00", "10.00"], ["10.00", "12.00"], ["12.00", "8.00"], ["8.00", "0.00"]]);
      expect(rows[0].allocations[0]).toEqual(allocation);
      expect(rows[1].allocations).toEqual([allocation, extra]);
      expect(rows[2].movementRefs.map(ref => ref.reversesMovementId)).toEqual([extra.movementId, allocation.movementId]);
      expect(rows[3].allocations).toEqual([]);
      await context(tx, f.company[1]);
      expect(await tx.select().from(revisions)).toHaveLength(0);
    });
  });
  it("rechaza saltos, antes inventado, duplicados, cantidades negativas y snapshots incompletos", async () => {
    await probe(async (tx, f) => {
      const identity = await addIdentity(tx, f);
      const first = revisionValues(f, identity.id);
      await rejected(tx, "23514", () => tx.insert(revisions).values({ ...first, previousQuantitySold: "1" }));
      await tx.insert(revisions).values(first);
      await rejected(tx, "23505", () => tx.insert(revisions).values(first));
      const next = revisionValues(f, identity.id, { revision: 1, quantitySold: "10" }, "12");
      await rejected(tx, "23503", () => tx.insert(revisions).values({ ...next, previousQuantitySold: "9" }));
      await rejected(tx, "23503", () => tx.insert(revisions).values({ ...next, revision: 3, previousRevision: 2 }));
      await rejected(tx, "23514", () => tx.insert(revisions).values({ ...next, previousRevision: null }));
      await rejected(tx, "23514", () => tx.insert(revisions).values({ ...next, quantitySold: "-1" }));
      await rejected(tx, "23514", () => tx.insert(revisions).values({ ...next, recipeSnapshot: {} as SaleRecipeSnapshot }));
    });
  });
  it("rechaza receta y referencia de identidad pertenecientes a otra empresa", async () => {
    await probe(async (tx, f) => {
      const identity = await addIdentity(tx, f);
      await rejected(tx, "42501", () => tx.insert(revisions).values({ ...revisionValues(f, identity.id), recipeId: f.recipe[1], recipeSnapshot: snapshot(f.recipe[1]) }));
      await context(tx, f.company[1], f.branch[2]);
      await rejected(tx, "23503", () => tx.insert(revisions).values({ ...revisionValues(f, identity.id), companyId: f.company[1], branchId: f.branch[2], recipeId: f.recipe[1], recipeSnapshot: snapshot(f.recipe[1]) }));
    });
  });
  it("la receta editable no cambia el snapshot y los hechos son inmutables incluso para el dueño", async () => {
    await probe(async (tx, f) => {
      const identity = await addIdentity(tx, f);
      const values = revisionValues(f, identity.id);
      await tx.insert(revisions).values(values);
      await tx.execute(sql.raw("RESET ROLE"));
      await tx.update(recipes).set({ name: "Nueva receta editable", baseYield: "2.00" }).where(eq(recipes.id, f.recipe[0]));
      await rejected(tx, "23514", () => tx.update(identities).set({ productKey: "rewritten" }).where(eq(identities.id, identity.id)));
      await rejected(tx, "23514", () => tx.update(revisions).set({ quantitySold: "99" }).where(eq(revisions.identityId, identity.id)));
      await rejected(tx, "23514", () => tx.delete(revisions).where(eq(revisions.identityId, identity.id)));
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const rows = await tx.select().from(revisions);
      expect(rows[0].recipeSnapshot).toEqual(values.recipeSnapshot);
      expect(rows[0].quantitySold).toBe("10.00");
      await tx.insert(revisions).values({ ...revisionValues(f, identity.id, rows[0], "10"), recipeId: f.recipe[2], recipeSnapshot: snapshot(f.recipe[2]) });
      expect(await tx.select().from(identities)).toHaveLength(1);
      const remapped = await tx.select().from(revisions).orderBy(revisions.revision);
      expect(remapped.map(row => row.recipeId)).toEqual([f.recipe[0], f.recipe[2]]);
    });
  });
});
