import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, inventoryItems, inventoryBatches, inventoryMovements, recipes, salesEntries, salesConsumptionIdentities, salesConsumptionRevisions } from "@/lib/db/schema";
import { provisionRuntimeRole } from "./helpers/runtime-role";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture = { company: string[]; branch: string[]; recipe: string[]; item: string[]; batch: string[]; movement: string[]; sale: string[] };
async function context(tx: Tx, company = "", branch = "") {
  await tx.execute(sql`SELECT set_config('app.current_company_id', ${company}, true), set_config('app.current_branch_id', ${branch}, true)`);
}
async function rejected(tx: Tx, code: string, action: () => Promise<unknown>) {
  await tx.execute(sql.raw("SAVEPOINT application_rejected"));
  let actual: string | undefined;
  try { await action(); } catch (error) { const failure = error as { code?: string; cause?: { code?: string } }; actual = failure.cause?.code ?? failure.code; }
  await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT application_rejected"));
  expect(actual).toBe(code);
}
async function probe(check: (tx: Tx, f: Fixture) => Promise<void>) {
  const ids = (count: number) => Array.from({ length: count }, () => randomUUID());
  const f: Fixture = { company: ids(2), branch: ids(3), recipe: ids(2), item: ids(2), batch: ids(3), movement: ids(3), sale: ids(3) };
  await expect(db.transaction(async tx => {
    await tx.insert(companies).values(f.company.map(id => ({ id, name: "Aplicación schema sintética" })));
    await tx.insert(branches).values(f.branch.map((id, i) => ({ id, companyId: f.company[i === 2 ? 1 : 0], name: "Sucursal aplicación sintética" })));
    await tx.insert(inventoryItems).values(f.item.map((id, i) => ({ id, companyId: f.company[i], name: "Ingrediente sintético", unit: "KG" })));
    await tx.insert(recipes).values(f.recipe.map((id, i) => ({ id, companyId: f.company[i], name: "Receta sintética", baseYield: "1" })));
    await tx.insert(inventoryBatches).values(f.batch.map((id, i) => ({ id, branchId: f.branch[i], itemId: f.item[i === 2 ? 1 : 0], initialQuantity: "5", currentQuantity: "4", status: "AVAILABLE" as const })));
    await tx.insert(inventoryMovements).values(f.movement.map((id, i) => ({ id, branchId: f.branch[i], itemId: f.item[i === 2 ? 1 : 0], batchId: f.batch[i], type: "USAGE" as const, quantityChange: "-1", performedBy: "synthetic-schema" })));
    await tx.insert(salesEntries).values(f.sale.map((id, i) => ({ id, companyId: f.company[i === 2 ? 1 : 0], branchId: f.branch[i], recipeId: f.recipe[i === 2 ? 1 : 0], quantitySold: "1", saleDate: new Date("2026-11-12T00:00:00Z"), totalRevenue: 100 })));
    await check(tx, f);
    throw new Error("application schema rollback esperado");
  })).rejects.toThrow("application schema rollback esperado");
  for (const id of f.company) expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
}

describe("INV-01.b3a: ingreso y mínimo runtime para aplicar consumo", () => {
  beforeAll(async () => {
    const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
    const operational = existsSync(".env") ? parse(readFileSync(".env")).DATABASE_URL : undefined;
    if (operational) expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(operational));
    await provisionRuntimeRole([]);
    await db.execute(sql`DO $$ BEGIN EXECUTE format('GRANT pulso_app TO %I', current_user); END $$`);
  });
  it("activa RLS sin FORCE en lotes/movimientos/ventas y conserva mínimo de privilegios", async () => {
    await probe(async tx => {
      const result = await tx.execute(sql`SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class
        WHERE oid IN ('public.inventory_batches'::regclass,'public.inventory_movements'::regclass,'public.sales_entries'::regclass)`);
      expect(result.rows).toHaveLength(3);
      for (const row of result.rows) expect(row).toMatchObject({ rls: true, force: false });
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const privileges = await tx.execute(sql`SELECT
        has_column_privilege(current_user,'public.inventory_batches','current_quantity','UPDATE') AS batch_balance,
        has_table_privilege(current_user,'public.inventory_batches','INSERT,DELETE') AS batch_create_delete,
        has_table_privilege(current_user,'public.inventory_movements','UPDATE,DELETE') AS movement_rewrite,
        has_table_privilege(current_user,'public.sales_entries','DELETE') AS sale_delete,
        has_column_privilege(current_user,'public.inventory_batches','supplier_batch_info','SELECT') AS supplier_info`);
      expect(privileges.rows[0]).toMatchObject({ batch_balance: true, batch_create_delete: false, movement_rewrite: false, sale_delete: false, supplier_info: false });
    });
  });
  it("sin contexto no lee; empresa y sucursal filtran también consultas sin WHERE", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await context(tx);
      for (const table of ["inventory_batches", "inventory_movements", "sales_entries"]) expect((await tx.execute(sql.raw(`SELECT id FROM public.${table}`))).rows).toEqual([]);
      await context(tx, f.company[0], f.branch[0]);
      expect((await tx.execute(sql`SELECT id FROM inventory_batches`)).rows).toEqual([{ id: f.batch[0] }]);
      expect((await tx.execute(sql`SELECT id FROM inventory_movements`)).rows).toEqual([{ id: f.movement[0] }]);
      expect((await tx.execute(sql`SELECT id FROM sales_entries`)).rows).toEqual([{ id: f.sale[0] }]);
      await context(tx, f.company[0]);
      expect((await tx.execute(sql`SELECT id FROM inventory_batches`)).rows.map(row => row.id).sort()).toEqual(f.batch.slice(0, 2).sort());
      await context(tx, f.company[1], f.branch[2]);
      expect((await tx.execute(sql`SELECT id FROM sales_entries`)).rows).toEqual([{ id: f.sale[2] }]);
    });
  });
  it("permite saldo propio y deniega lote ajeno, movimiento lateral y borrados reales", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await context(tx, f.company[0], f.branch[0]);
      expect((await tx.execute(sql`UPDATE inventory_batches SET current_quantity=current_quantity-1 WHERE id=${f.batch[0]} RETURNING id`)).rows).toEqual([{ id: f.batch[0] }]);
      expect((await tx.execute(sql`UPDATE inventory_batches SET current_quantity=0 WHERE id=${f.batch[2]} RETURNING id`)).rows).toEqual([]);
      expect((await tx.execute(sql`UPDATE inventory_batches SET current_quantity=0 WHERE id=${f.batch[1]} RETURNING id`)).rows).toEqual([]);
      await rejected(tx, "42501", () => tx.execute(sql`INSERT INTO inventory_movements (branch_id,item_id,batch_id,type,quantity_change) VALUES (${f.branch[0]},${f.item[0]},${f.batch[2]},'USAGE',-1)`));
      await rejected(tx, "42501", () => tx.execute(sql`INSERT INTO sales_entries (company_id,branch_id,recipe_id,quantity_sold) VALUES (${f.company[0]},${f.branch[0]},${f.recipe[1]},1)`));
      for (const table of ["inventory_batches", "inventory_movements", "sales_entries"]) await rejected(tx, "42501", () => tx.execute(sql.raw(`DELETE FROM ${table}`)));
      await rejected(tx, "42501", () => tx.execute(sql`UPDATE inventory_movements SET quantity_change=0`));
    });
  });
  it("conserva NULL histórico, acepta centavos explícitos e impide ingreso negativo o reescritura", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await context(tx, f.company[0], f.branch[0]);
      const [identity] = await tx.insert(salesConsumptionIdentities).values({ companyId: f.company[0], branchId: f.branch[0], source: "pos:test", productKey: "schema", saleDay: "2026-11-12" }).returning();
      const [legacy] = await tx.insert(salesConsumptionRevisions).values({ identityId: identity.id, companyId: f.company[0], branchId: f.branch[0], revision: 1, previousRevision: null, previousQuantitySold: "0", quantitySold: "1", recipeId: f.recipe[0], recipeSnapshot: { schemaVersion: 1, recipeId: f.recipe[0], versionKey: "schema-fixture", definition: {} }, allocations: [], movementRefs: [], recordedBy: "synthetic-schema" }).returning();
      const add = (revenue: number) => tx.execute(sql`INSERT INTO sales_consumption_revisions
        (identity_id,company_id,branch_id,revision,previous_revision,previous_quantity_sold,quantity_sold,recipe_id,recipe_snapshot,allocations,movement_refs,recorded_by,total_revenue)
        SELECT identity_id,company_id,branch_id,2,1,quantity_sold,quantity_sold,recipe_id,recipe_snapshot,allocations,movement_refs,recorded_by,${revenue}
        FROM sales_consumption_revisions WHERE id=${legacy.id} RETURNING total_revenue`);
      expect((await tx.execute(sql`SELECT total_revenue FROM sales_consumption_revisions WHERE id=${legacy.id}`)).rows[0].total_revenue).toBeNull();
      await rejected(tx, "23514", () => add(-1));
      expect((await add(200)).rows[0].total_revenue).toBe(200);
      await rejected(tx, "42501", () => tx.execute(sql`UPDATE sales_consumption_revisions SET total_revenue=0 WHERE id=${legacy.id}`));
      await tx.execute(sql.raw("RESET ROLE"));
      await rejected(tx, "23514", () => tx.execute(sql`UPDATE sales_consumption_revisions SET total_revenue=0 WHERE id=${legacy.id}`));
    });
  });
});
