import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';

const enabled = process.env.RUN_SALES_RUNTIME_NEXT_BROWSER === '1';
const makeRuntime = (url: string) => {
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  return { pool, db: drizzle(pool, { schema }) };
};
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let runtime: ReturnType<typeof makeRuntime> | undefined;
const originalDatabaseUrl = process.env.DATABASE_URL;
const company = [randomUUID(), randomUUID()], branch = [randomUUID(), randomUUID(), randomUUID()];
const recipe = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const grantName = () => fixture!.owner.execute(sql.raw(readFileSync('drizzle/0141_inv01b_import_recipe_name.sql', 'utf8')
  .replaceAll('pulso_app', fixture!.roleName)));

beforeAll(async () => {
  if (!enabled) return;
  fixture = await createSalesRuntimeDatabase();
  process.env.DATABASE_URL = fixture.ownerUrl;
  runtime = makeRuntime(fixture.runtimeUrl);
  await fixture.owner.transaction(async tx => {
    await tx.insert(schema.companies).values(company.map(id => ({ id, name: 'Synthetic catalog acceptance' })));
    await tx.insert(schema.branches).values(branch.map((id, index) => ({ id, companyId: company[index === 2 ? 1 : 0], name: 'Synthetic catalog branch' })));
    await tx.insert(schema.recipes).values(recipe.map((id, index) => ({ id, companyId: company[index === 1 ? 1 : 0],
      name: index < 2 ? 'Catalog dish' : index === 2 ? 'Ambiguous' : ' AMBIGUOUS ', baseYield: '1', unit: 'PORTION' })));
  });
}, 150_000);

afterAll(async () => {
  try { await runtime?.pool.end(); }
  finally {
    try { await fixture?.close(); }
    finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
}, 90_000);

it.skipIf(!enabled)('catalog runtime: 0141 grants name only and remains idempotent', async () => {
  const flags = await runtime!.pool.query(`SELECT current_user, session_user, rolbypassrls, rolsuper,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships FROM pg_roles r WHERE rolname=current_user`);
  expect(flags.rows[0]).toEqual({ current_user: fixture!.roleName, session_user: fixture!.roleName,
    rolbypassrls: false, rolsuper: false, memberships: 0 });
  const privileges = async () => (await runtime!.pool.query(`SELECT
    has_column_privilege(current_user,'public.recipes','name','SELECT') AS name,
    has_table_privilege(current_user,'public.recipes','SELECT') AS all_columns,
    has_table_privilege(current_user,'public.recipes','INSERT') AS insert_rows,
    has_table_privilege(current_user,'public.recipes','UPDATE') AS update_rows,
    has_table_privilege(current_user,'public.recipes','DELETE') AS delete_rows`)).rows[0];
  try {
    await fixture!.owner.execute(sql.raw(`REVOKE SELECT(name) ON public.recipes FROM "${fixture!.roleName}"`));
    expect(await privileges()).toEqual({ name: false, all_columns: false, insert_rows: false, update_rows: false, delete_rows: false });
    await expect(runtime!.pool.query('SELECT name FROM public.recipes')).rejects.toMatchObject({ code: '42501' });
    await grantName();
    const granted = await privileges();
    expect(granted).toEqual({ name: true, all_columns: false, insert_rows: false, update_rows: false, delete_rows: false });
    await grantName();
    expect(await privileges()).toEqual(granted);
    expect((await runtime!.pool.query('SELECT id,name FROM public.recipes')).rows).toEqual([]);
  } finally { await grantName(); }
}, 60_000);

it.skipIf(!enabled)('catalog runtime: own branches share names without exposing other companies or ambiguous references', async () => {
  const { SalesIngestService } = await import('@/lib/services/sales-ingest-service');
  for (const branchId of branch.slice(0, 2)) {
    await runtime!.db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${company[0]}, true), set_config('app.current_branch_id', ${branchId}, true)`);
      const visible = await tx.select({ id: schema.recipes.id }).from(schema.recipes);
      expect(visible.map(row => row.id).sort()).toEqual([recipe[0], recipe[2], recipe[3]].sort());
      const resolved = await SalesIngestService.resolveRecipeRefs(company[0], [recipe[0], recipe[1], ' catalog DISH ', 'ambiguous'], tx);
      expect(Object.fromEntries(resolved)).toEqual({ [recipe[0]]: recipe[0], [recipe[1]]: null, ' catalog DISH ': recipe[0], ambiguous: null });
    });
    expect((await runtime!.pool.query('SELECT id,name FROM public.recipes')).rows).toEqual([]);
  }
  await runtime!.db.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.current_company_id', ${company[1]}, true), set_config('app.current_branch_id', ${branch[2]}, true)`);
    expect(await tx.select({ id: schema.recipes.id }).from(schema.recipes)).toEqual([{ id: recipe[1] }]);
    expect(Object.fromEntries(await SalesIngestService.resolveRecipeRefs(company[0], [recipe[0], recipe[1], 'Catalog dish'], tx)))
      .toEqual({ [recipe[0]]: null, [recipe[1]]: null, 'Catalog dish': null });
  });
}, 90_000);

it.skipIf(!enabled)('catalog runtime: real writes stay denied even with valid company context', async () => {
  const attempts: [string, string[]][] = [
    ['UPDATE public.recipes SET name=name WHERE id=$1', [recipe[0]]],
    ['DELETE FROM public.recipes WHERE id=$1', [recipe[0]]],
    ['INSERT INTO public.recipes(id,company_id,name) VALUES($1,$2,$3)', [randomUUID(), company[0], 'Forbidden catalog write']],
    ['TRUNCATE public.recipes', []],
  ];
  for (const [statement, values] of attempts) {
    const client = await runtime!.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_company_id',$1,true),set_config('app.current_branch_id',$2,true)", [company[0], branch[0]]);
      await expect(client.query(statement, values)).rejects.toMatchObject({ code: '42501' });
    } finally { await client.query('ROLLBACK'); client.release(); }
  }
  expect((await runtime!.pool.query('SELECT id,name FROM public.recipes')).rows).toEqual([]);
}, 90_000);
