import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, inventoryItems, recipes, recipeItems, unitConversions } from "@/lib/db/schema";
import { provisionRuntimeRole } from "./helpers/runtime-role";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture = { company: string[]; branch: string[]; recipe: string[]; item: string[]; line: string[]; conversion: string[] };
const catalog = ["recipes", "recipe_items", "inventory_items", "unit_conversions"];
async function scope(tx: Tx, company = "", branch = "") {
  await tx.execute(sql`SELECT set_config('app.current_company_id', ${company}, true), set_config('app.current_branch_id', ${branch}, true)`);
}
async function probe(check: (tx: Tx, f: Fixture) => Promise<void>) {
  const pair = () => [randomUUID(), randomUUID()];
  const f: Fixture = { company: pair(), branch: [randomUUID(), randomUUID(), randomUUID()], recipe: pair(), item: pair(), line: pair(), conversion: pair() };
  await expect(db.transaction(async tx => {
    await tx.insert(companies).values(f.company.map(id => ({ id, name: "Catálogo RLS sintético" })));
    await tx.insert(branches).values(f.branch.map((id, index) => ({ id, companyId: f.company[index === 2 ? 1 : 0], name: "Sucursal catálogo sintética" })));
    await tx.insert(inventoryItems).values(f.item.map((id, index) => ({ id, companyId: f.company[index], name: "Ingrediente catálogo sintético", unit: "KG" })));
    await tx.insert(recipes).values(f.recipe.map((id, index) => ({ id, companyId: f.company[index], name: "Receta catálogo sintética", baseYield: "1", unit: "PORTION" })));
    await tx.insert(recipeItems).values(f.line.map((id, index) => ({ id, recipeId: f.recipe[index], itemId: f.item[index], quantity: "1", unit: "KG", isSubRecipe: false })));
    await tx.insert(unitConversions).values(f.conversion.map((id, index) => ({ id, companyId: f.company[index], fromUnit: "G", toUnit: "KG", factor: "0.001000" })));
    await check(tx, f);
    throw new Error("catalog rollback esperado");
  })).rejects.toThrow("catalog rollback esperado");
  for (const id of f.company) expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
}
async function ids(tx: Tx, table: string) {
  return (await tx.execute<{ id: string }>(sql.raw(`SELECT id FROM public.${table} ORDER BY id`))).rows.map(row => row.id);
}
async function denied(tx: Tx, action: () => Promise<unknown>) {
  await tx.execute(sql.raw("SAVEPOINT catalog_denied"));
  let code: string | undefined;
  try { await action(); } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    code = failure.cause?.code ?? failure.code;
  }
  await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT catalog_denied"));
  expect(code).toBe("42501");
}

describe("INV-01.b2a: catálogo compartido por empresa con runtime de solo lectura", () => {
  beforeAll(async () => {
    const host = (value: string) => new URL(value).hostname.replace(/-pooler(?=\.)/, "");
    const operational = existsSync(".env") ? parse(readFileSync(".env")).DATABASE_URL : undefined;
    if (operational) expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(operational));
    await provisionRuntimeRole([]); // Los SELECT de columnas deben proceder de la migración.
    await db.execute(sql`DO $$ BEGIN EXECUTE format('GRANT pulso_app TO %I', current_user); END $$`);
  });
  it("habilita RLS de lectura sin ampliar el rol ni romper la conexión dueña actual", async () => {
    await probe(async (tx, f) => {
      const rows = await tx.execute(sql`SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
        pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('recipes','recipe_items','inventory_items','unit_conversions')`);
      expect(rows.rows).toHaveLength(4);
      for (const row of rows.rows) expect(row).toMatchObject({ rls: true, force: false });
      // Compatibilidad explícita: dueño aún omite RLS en estas tablas. SEC-05
      // migrará sus writers al contexto antes de exigir FORCE RLS.
      await scope(tx);
      expect(await ids(tx, "recipes")).toEqual(expect.arrayContaining(f.recipe));
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const role = (await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0];
      expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });
      expect(rows.rows.every(row => row.owner !== "pulso_app")).toBe(true);
    });
  });
  it("sin empresa no lee; con A no lee B, ni en consultas sin filtro de empresa", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await scope(tx);
      for (const table of catalog) expect(await ids(tx, table)).toEqual([]);
      await scope(tx, f.company[0], f.branch[0]);
      for (const [table, expected] of [["recipes", f.recipe[0]], ["recipe_items", f.line[0]], ["inventory_items", f.item[0]], ["unit_conversions", f.conversion[0]]]) {
        expect(await ids(tx, table)).toEqual([expected]);
      }
      await scope(tx, f.company[1], f.branch[2]);
      expect(await ids(tx, "recipes")).toEqual([f.recipe[1]]);
      expect(await ids(tx, "recipe_items")).toEqual([f.line[1]]);
      expect(await ids(tx, "inventory_items")).toEqual([f.item[1]]);
      expect(await ids(tx, "unit_conversions")).toEqual([f.conversion[1]]);
    });
  });
  it("dos sucursales propias comparten el catálogo sin cambiar de empresa", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      for (const branch of f.branch.slice(0, 2)) {
        await scope(tx, f.company[0], branch);
        expect(await ids(tx, "recipes")).toEqual([f.recipe[0]]);
        expect(await ids(tx, "inventory_items")).toEqual([f.item[0]]);
      }
    });
  });
  it("otorga columnas necesarias, sin SELECT general, columnas de costo ni DML", async () => {
    await probe(async tx => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const result = await tx.execute(sql`SELECT table_name, column_name,
        has_column_privilege(current_user, format('public.%I', table_name), column_name, 'SELECT') AS read
        FROM information_schema.columns WHERE table_schema='public'
        AND table_name IN ('recipes','recipe_items','inventory_items','unit_conversions')`);
      const allowed: Record<string, string[]> = {
        recipes: ["id", "company_id", "base_yield", "unit"],
        recipe_items: ["id", "recipe_id", "item_id", "quantity", "unit", "is_sub_recipe", "yield_percent"],
        inventory_items: ["id", "company_id", "unit"],
        unit_conversions: ["id", "company_id", "from_unit", "to_unit", "factor"],
      };
      // information_schema oculta columnas sin permisos: verificar las concedidas
      // y consultar las no concedidas expresamente mediante has_column_privilege.
      for (const table of catalog) {
        const visible = result.rows.filter(row => row.table_name === table && row.read).map(row => row.column_name);
        expect(visible.sort()).toEqual(allowed[table].sort());
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const check = await tx.execute(sql`SELECT has_table_privilege(current_user, ${`public.${table}`}, ${privilege}) AS allowed`);
          expect(check.rows[0].allowed).toBe(false);
        }
        for (const privilege of ["INSERT", "UPDATE"]) {
          const check = await tx.execute(sql`SELECT has_any_column_privilege(current_user, ${`public.${table}`}, ${privilege}) AS allowed`);
          expect(check.rows[0].allowed).toBe(false);
        }
      }
      const privateFields = await tx.execute(sql`SELECT has_column_privilege(current_user,'public.inventory_items','average_cost','SELECT') AS cost,
        has_column_privilege(current_user,'public.recipes','price_selling','SELECT') AS price`);
      expect(privateFields.rows[0]).toMatchObject({ cost: false, price: false });
    });
  });
  it("deniega INSERT, UPDATE y DELETE reales aunque la fila sea propia", async () => {
    await probe(async (tx, f) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await scope(tx, f.company[0], f.branch[0]);
      for (const table of catalog) {
        expect(await ids(tx, table)).toHaveLength(1);
        await denied(tx, () => tx.execute(sql.raw(`UPDATE public.${table} SET id=id`)));
        await denied(tx, () => tx.execute(sql.raw(`DELETE FROM public.${table}`)));
        await denied(tx, () => tx.execute(sql.raw(`INSERT INTO public.${table} DEFAULT VALUES`)));
      }
    });
  });
});
