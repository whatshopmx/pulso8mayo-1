import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { SalesIngestService } from '@/lib/services/sales-ingest-service';
import { withSalesWriterTransaction } from '@/lib/db/sales-runtime';

// Login real de Postgres, no SET ROLE ni mocks. Rol efímero con los grants
// declarados por las migraciones; no modifica el rol pulso_app compartido.
// Los catálogos sintéticos se confirman para que otra conexión pueda leerlos.
// Las identidades/revisiones append-only nunca salen de una transacción rollback.
const roleName = `inv_runtime_${randomUUID().replaceAll('-', '')}`;
const rolePassword = randomUUID(); // Credencial sintética, solo en memoria.
const runtimeConnection = new URL(process.env.TEST_DATABASE_URL!);
runtimeConnection.username = roleName;
runtimeConnection.password = rolePassword;
const pool = new Pool({ connectionString: runtimeConnection.toString(), max: 1, allowExitOnIdle: true,
  connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
const runtime = drizzle(pool, { schema });
const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
const company = ids(2), branch = ids(3), item = ids(2), recipe = ids(2), batch = ids(3);
const day = '2026-11-19';
let seeded = false;
let roleCreated = false;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function rollback(run: (tx: Tx) => Promise<void>) {
  const sentinel = new Error('Independent runtime rollback');
  try {
    await withSalesWriterTransaction(async tx => {
      expect((await tx.execute(sql`SELECT current_user, session_user, current_setting('transaction_isolation') AS isolation`)).rows[0])
        .toMatchObject({ current_user: roleName, session_user: roleName, isolation: 'serializable' });
      await run(tx); throw sentinel;
    });
  } catch (error) { if (error !== sentinel) throw error; }
  expect(await db.select({ id: schema.salesConsumptionIdentities.id }).from(schema.salesConsumptionIdentities)
    .where(inArray(schema.salesConsumptionIdentities.companyId, company))).toEqual([]);
  expect(await db.select({ id: schema.inventoryMovements.id }).from(schema.inventoryMovements)
    .where(inArray(schema.inventoryMovements.branchId, branch))).toEqual([]);
}

beforeAll(async () => {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, '');
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync('.env')).DATABASE_URL));
  // Both interpolated identifiers/values are generated UUIDs, never external input.
  // Do not propagate driver errors that could include the credential SQL.
  try {
    await db.execute(sql.raw(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}' NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB`));
    roleCreated = true;
  } catch { throw new Error('Could not create the isolated synthetic runtime role'); }
  await db.transaction(async tx => {
    for (const file of ['0137_inv01a_sale_consumption_identity.sql', '0138_inv01b_recipe_reader.sql',
      '0139_inv01b_application_scope.sql', '0141_inv01b_import_recipe_name.sql']) {
      const grants = readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint').at(-1)!;
      expect(grants).toContain('DO $$ BEGIN');
      await tx.execute(sql.raw(grants.replaceAll('pulso_app', roleName)));
    }
  });
  const role = (await runtime.execute(sql`SELECT current_user, session_user, rolbypassrls, rolsuper, rolcreaterole,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships
    FROM pg_roles r WHERE rolname=current_user`)).rows[0];
  expect(role).toMatchObject({ current_user: roleName, session_user: roleName,
    rolbypassrls: false, rolsuper: false, rolcreaterole: false, memberships: 0 });
  const tables = (await runtime.execute(sql`SELECT c.relname, c.relrowsecurity, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND c.relname IN ('recipes','inventory_batches','sales_entries','sales_consumption_identities','sales_consumption_revisions')`)).rows;
  expect(tables).toHaveLength(5);
  for (const table of tables) { expect(table.relrowsecurity).toBe(true); expect(table.owner).not.toBe(roleName); }
  const privileges = (await runtime.execute(sql`SELECT
    has_table_privilege(current_user,'public.recipes','SELECT') AS all_recipes,
    has_table_privilege(current_user,'public.recipes','UPDATE') AS update_recipes,
    has_table_privilege(current_user,'public.inventory_batches','DELETE') AS delete_batches,
    has_table_privilege(current_user,'public.sales_entries','DELETE') AS delete_sales,
    has_table_privilege(current_user,'public.inventory_movements','UPDATE') AS update_movements,
    has_column_privilege(current_user,'public.recipes','name','SELECT') AS recipe_name`)).rows[0];
  expect(privileges).toEqual({ all_recipes: false, update_recipes: false, delete_batches: false,
    delete_sales: false, update_movements: false, recipe_name: true });
  await db.transaction(async tx => {
    await tx.insert(schema.companies).values(company.map(id => ({ id, name: 'Synthetic independent runtime' })));
    await tx.insert(schema.branches).values(branch.map((id, n) => ({ id, companyId: company[n === 2 ? 1 : 0], name: 'Synthetic runtime branch' })));
    await tx.insert(schema.inventoryItems).values(item.map((id, n) => ({ id, companyId: company[n], name: 'Runtime ingredient', unit: 'KG' })));
    await tx.insert(schema.recipes).values(recipe.map((id, n) => ({ id, companyId: company[n], name: `Runtime dish ${n}`, baseYield: '1', unit: 'PORTION' })));
    await tx.insert(schema.recipeItems).values(recipe.map((recipeId, n) => ({ recipeId, itemId: item[n], quantity: '1', unit: 'KG', yieldPercent: 100 })));
    await tx.insert(schema.inventoryBatches).values(batch.map((id, n) => ({ id, itemId: item[n === 2 ? 1 : 0], branchId: branch[n],
      initialQuantity: '20', currentQuantity: '20', status: 'AVAILABLE' as const, expirationDate: new Date('2099-01-01') })));
  });
  seeded = true;
  vi.stubEnv('SALES_RUNTIME_DATABASE_URL', runtimeConnection.toString());
}, 90_000);

afterAll(async () => {
  try {
    if (seeded) {
      // Fail closed before deleting catalogs if an append-only write escaped rollback.
      expect(await db.select({ id: schema.salesConsumptionIdentities.id }).from(schema.salesConsumptionIdentities)
        .where(inArray(schema.salesConsumptionIdentities.companyId, company))).toEqual([]);
      expect(await db.select({ id: schema.salesEntries.id }).from(schema.salesEntries)
        .where(inArray(schema.salesEntries.companyId, company))).toEqual([]);
      await db.transaction(async tx => {
        await tx.delete(schema.inventoryBatches).where(inArray(schema.inventoryBatches.id, batch));
        await tx.delete(schema.recipeItems).where(inArray(schema.recipeItems.recipeId, recipe));
        await tx.delete(schema.recipes).where(inArray(schema.recipes.id, recipe));
        await tx.delete(schema.inventoryItems).where(inArray(schema.inventoryItems.id, item));
        await tx.delete(schema.branches).where(inArray(schema.branches.id, branch));
        await tx.delete(schema.companies).where(inArray(schema.companies.id, company));
      });
      expect(await db.select({ id: schema.companies.id }).from(schema.companies).where(inArray(schema.companies.id, company))).toEqual([]);
    }
  } finally {
    vi.unstubAllEnvs();
    await pool.end();
    if (roleCreated) {
      // The fresh role must own no object. Revoke grants as their owner without
      // acquiring membership in the runtime role (required by DROP OWNED).
      const owned = (await db.execute(sql`SELECT c.oid FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname=${roleName}
        UNION ALL SELECT n.oid FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE r.rolname=${roleName}
        UNION ALL SELECT p.oid FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname=${roleName}
        UNION ALL SELECT d.oid FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE r.rolname=${roleName}`)).rows;
      expect(owned).toEqual([]);
      await db.transaction(async tx => {
        for (const table of ['branches', 'recipes', 'recipe_items', 'inventory_items', 'unit_conversions',
          'inventory_batches', 'inventory_movements', 'sales_entries', 'sales_consumption_identities', 'sales_consumption_revisions']) {
          const columns = (await tx.execute<{ name: string }>(sql`SELECT quote_ident(attname) AS name FROM pg_attribute
            WHERE attrelid=${`public.${table}`}::regclass AND attnum>0 AND NOT attisdropped`)).rows;
          await tx.execute(sql.raw(`REVOKE ALL PRIVILEGES ON public.${table} FROM "${roleName}"`));
          await tx.execute(sql.raw(`REVOKE ALL PRIVILEGES (${columns.map(column => column.name).join(',')}) ON public.${table} FROM "${roleName}"`));
        }
        await tx.execute(sql.raw(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM "${roleName}"`));
      });
      await db.execute(sql.raw(`DROP ROLE "${roleName}"`));
      expect((await db.execute(sql`SELECT rolname FROM pg_roles WHERE rolname=${roleName}`)).rows).toEqual([]);
    }
  }
}, 90_000);

for (const source of ['manual:recipe', 'pos:import']) {
  it(`independent login ${source}: correction, retry, revenue and zero preserve exact stock`, async () => {
    await rollback(async tx => {
      const read = async () => ({
        stock: (await tx.select({ quantity: schema.inventoryBatches.currentQuantity }).from(schema.inventoryBatches)
          .where(eq(schema.inventoryBatches.id, batch[0])))[0]?.quantity,
        movements: await tx.select({ id: schema.inventoryMovements.id, quantity: schema.inventoryMovements.quantityChange })
          .from(schema.inventoryMovements).where(eq(schema.inventoryMovements.branchId, branch[0])).orderBy(schema.inventoryMovements.id),
        revisions: await tx.select().from(schema.salesConsumptionRevisions).where(eq(schema.salesConsumptionRevisions.companyId, company[0]))
          .orderBy(schema.salesConsumptionRevisions.revision),
      });
      const submit = (quantitySold: number, totalRevenueCents: number | null = null) => SalesIngestService.ingestInTransaction(tx, {
        companyId: company[0], branchId: branch[0], userId: 'synthetic-independent-runtime', source, atomic: true,
        rows: [{ rowNumber: 1, recipeRef: recipe[0], productKey: source === 'manual:recipe' ? recipe[0] : 'POS-01',
          saleDay: day, quantitySold, totalRevenueCents }],
      });
      expect(await submit(10)).toMatchObject({ inserted: 1, revenueComplete: false });
      expect((await read()).stock).toBe('10.0000');
      expect(await submit(12)).toMatchObject({ updated: 1 });
      expect((await read()).stock).toBe('8.0000');
      expect(await submit(8)).toMatchObject({ updated: 1 });
      const corrected = await read();
      expect(corrected.stock).toBe('12.0000');
      expect(await submit(8)).toMatchObject({ skipped: 1 });
      expect(await read()).toEqual(corrected);
      expect(await submit(8, 8025)).toMatchObject({ updated: 1, revenueComplete: true });
      expect((await read()).movements).toEqual(corrected.movements);
      expect(await tx.select({ revenue: schema.salesEntries.totalRevenue }).from(schema.salesEntries)
        .where(and(eq(schema.salesEntries.companyId, company[0]), eq(schema.salesEntries.branchId, branch[0])))).toEqual([{ revenue: 8025 }]);
      expect(await submit(0, 0)).toMatchObject({ updated: 1, revenueComplete: true });
      expect((await read()).stock).toBe('20.0000');
      expect((await read()).revisions).toHaveLength(5);
    });
    expect(await db.select({ quantity: schema.inventoryBatches.currentQuantity }).from(schema.inventoryBatches)
      .where(eq(schema.inventoryBatches.id, batch[0]))).toEqual([{ quantity: '20.0000' }]);
  }, 180_000);
}

it('independent pooled login: no context, cross-company and branch isolation, no context after rollback', async () => {
  await rollback(async tx => {
    expect(await tx.select({ id: schema.recipes.id }).from(schema.recipes).where(inArray(schema.recipes.id, recipe))).toEqual([]);
    await tx.execute(sql`SELECT set_config('app.current_company_id', ${company[0]}, true), set_config('app.current_branch_id', ${branch[0]}, true)`);
    expect(await tx.select({ id: schema.recipes.id }).from(schema.recipes).where(inArray(schema.recipes.id, recipe))).toEqual([{ id: recipe[0] }]);
    expect(await tx.select({ id: schema.inventoryBatches.id }).from(schema.inventoryBatches).where(inArray(schema.inventoryBatches.id, batch))).toEqual([{ id: batch[0] }]);
    await expect(SalesIngestService.ingestInTransaction(tx, { companyId: company[0], branchId: branch[2], userId: 'synthetic-runtime', rows: [] }))
      .rejects.toMatchObject({ code: 'INVALID_SCOPE' });
  });
  const context = (await runtime.execute(sql`SELECT nullif(current_setting('app.current_company_id',true),'') AS company,
    nullif(current_setting('app.current_branch_id',true),'') AS branch, current_user, session_user`)).rows[0];
  expect(context).toMatchObject({ company: null, branch: null, current_user: roleName, session_user: roleName });
});

it('independent minimum-grant login rejects catalog writes, stock deletion and movement rewrites', async () => {
  await rollback(async tx => {
    await tx.execute(sql`SELECT set_config('app.current_company_id', ${company[0]}, true), set_config('app.current_branch_id', ${branch[0]}, true)`);
    for (const statement of [
      sql`UPDATE recipes SET name=name WHERE id=${recipe[0]}`,
      sql`DELETE FROM inventory_batches WHERE id=${batch[0]}`,
      sql`DELETE FROM sales_entries WHERE company_id=${company[0]}`,
      sql`UPDATE inventory_movements SET quantity_change=0 WHERE branch_id=${branch[0]}`,
    ]) {
      await expect(tx.transaction(scoped => scoped.execute(statement))).rejects.toSatisfy((error: { code?: string; cause?: { code?: string } }) =>
        (error.cause?.code ?? error.code) === '42501');
    }
    expect(await tx.select({ quantity: schema.inventoryBatches.currentQuantity }).from(schema.inventoryBatches)
      .where(eq(schema.inventoryBatches.id, batch[0]))).toEqual([{ quantity: '20.0000' }]);
    await expect(SalesIngestService.ingestInTransaction(tx, { companyId: company[0], branchId: branch[0], userId: 'synthetic-runtime', atomic: true,
      rows: [{ rowNumber: 1, recipeRef: recipe[1], productKey: 'foreign', saleDay: day, quantitySold: 1, totalRevenueCents: 0 }] }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
