import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { NextRequest } from 'next/server';

// Real auth, HTTP, handler, writer and PostgreSQL. Only request-local Next
// storage and the transaction boundary are supplied by the rollback fixture.
const fixture = vi.hoisted(() => ({ tx: null as unknown, headers: new Headers(), runtimeCalls: 0 }));
vi.mock('@/lib/db', async original => {
  const actual = await original<typeof import('@/lib/db')>();
  return { db: new Proxy(actual.db, { get(target, key) {
    if (key === 'transaction' && fixture.tx) {
      return async (run: (tx: unknown) => Promise<unknown>, options?: { isolationLevel?: string }) => {
        const tx = fixture.tx as Parameters<Parameters<typeof actual.db.transaction>[0]>[0];
        try {
          return await tx.transaction(async scoped => {
            if (options?.isolationLevel === 'serializable') {
              await scoped.execute(sql.raw('SET LOCAL ROLE pulso_app'));
              const role = (await scoped.execute(sql`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0];
              expect(role).toMatchObject({ rolname: 'pulso_app', rolbypassrls: false, rolsuper: false });
              const grants = (await scoped.execute(sql`SELECT
                has_table_privilege(current_user,'public.inventory_batches','DELETE') AS delete_batches,
                has_table_privilege(current_user,'public.recipes','UPDATE') AS update_recipes,
                has_table_privilege(current_user,'public.sales_entries','DELETE') AS delete_sales`)).rows[0];
              expect(grants).toMatchObject({ delete_batches: false, update_recipes: false, delete_sales: false });
              fixture.runtimeCalls++;
            }
            return run(scoped);
          });
        } finally { await tx.execute(sql.raw('RESET ROLE')); }
      };
    }
    const source = fixture.tx ?? target;
    const value = Reflect.get(source as object, key);
    return typeof value === 'function' ? value.bind(source) : value;
  } }) };
});
vi.mock('next/headers', () => ({
  headers: async () => fixture.headers,
  cookies: async () => ({ get: (name: string) => {
    const value = fixture.headers.get('cookie')?.split('; ').find(c => c.startsWith(`${name}=`))?.slice(name.length + 1);
    return value ? { value } : undefined;
  }, set: () => {} }),
}));

import { db } from '@/lib/db';
import { account, users, sessions, companies, branches, recipes, recipeItems, inventoryItems,
  inventoryBatches, inventoryMovements, salesEntries, salesConsumptionIdentities, salesConsumptionRevisions } from '@/lib/db/schema';
import { auth } from '@/lib/auth';
import { POST } from '@/app/api/inventory/sales-entry/route';
import { POST as bulkPOST } from '@/app/api/inventory/sales-entry/bulk/route';

const endpoint = '/api/inventory/sales-entry', day = '2026-11-19';
let baseURL: string;
const server = createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [name, values] of Object.entries(req.headers))
      for (const value of Array.isArray(values) ? values : values ? [values] : []) headers.append(name, value);
    fixture.headers = headers;
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    const url = `http://localhost:3000${req.url}`;
    const response = req.url?.startsWith('/api/auth/')
      ? await auth.handler(new Request(url, { method: req.method, headers, body: body || undefined }))
      : await (req.url === `${endpoint}/bulk` ? bulkPOST : POST)(new NextRequest(url, { method: 'POST', headers, body }));
    res.statusCode = response.status;
    response.headers.forEach((value, name) => { if (name !== 'set-cookie') res.setHeader(name, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.statusCode = 500; res.end('Test server failed'); }
});

beforeAll(async () => {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, '');
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync('.env')).DATABASE_URL));
  const role = (await db.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname='pulso_app'`)).rows[0];
  expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  baseURL = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Scope = { company: string[]; branch: string[]; recipe: string[]; batch: string[];
  bulk: (csvText: string, branchId?: string) => Promise<Response>;
  login: (index?: number) => Promise<void>; post: (sales: object[], branchId?: string) => Promise<Response> };
async function probe(check: (tx: Tx, f: Scope) => Promise<void>) {
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
  const company = ids(2), branch = ids(3), recipe = ids(3), item = ids(3), batch = ids(3), actor = ids(5);
  const password = `Synthetic-${randomUUID()}`, hash = await hashPassword(password), now = new Date();
  const rollback = new Error('Manual HTTP fixture rollback');
  let failure: unknown;
  try { await db.transaction(async tx => {
    fixture.tx = tx; fixture.headers = new Headers(); fixture.runtimeCalls = 0;
    await tx.insert(companies).values(company.map(id => ({ id, name: 'Synthetic manual HTTP company' })));
    await tx.insert(branches).values(branch.map((id, n) => ({ id, companyId: company[n === 2 ? 1 : 0], name: 'Synthetic manual HTTP branch' })));
    await tx.insert(inventoryItems).values(item.map((id, n) => ({ id, companyId: company[n === 2 ? 1 : 0], name: 'Ingredient', unit: 'KG' })));
    await tx.insert(recipes).values(recipe.map((id, n) => ({ id, companyId: company[n === 2 ? 1 : 0], name: `Manual dish ${n}`, baseYield: '1', unit: 'PORTION' })));
    await tx.insert(recipeItems).values(recipe.map((recipeId, n) => ({ recipeId, itemId: item[n], quantity: '1', unit: 'KG', yieldPercent: 100 })));
    await tx.insert(inventoryBatches).values(batch.map((id, n) => ({ id, itemId: item[n], branchId: branch[n === 2 ? 2 : 0],
      initialQuantity: '20', currentQuantity: '20', status: 'AVAILABLE' as const, expirationDate: new Date('2099-01-01') })));
    const roles = ['ADMIN', 'GERENTE', 'EMPLEADO', 'GERENTE', 'ADMIN'] as const;
    await tx.insert(users).values(actor.map((id, n) => ({ id, companyId: company[n === 4 ? 1 : 0],
      branchId: n === 1 || n === 2 ? branch[0] : n === 4 ? branch[2] : null, role: roles[n],
      email: `${id}@example.invalid`, name: 'Synthetic manual actor', emailVerified: true, createdAt: now, updatedAt: now })));
    await tx.insert(account).values(actor.map(id => ({ id: randomUUID(), userId: id, accountId: id,
      providerId: 'credential', password: hash, createdAt: now, updatedAt: now })));
    // Reconstruct declared privileges in rollback; broad grants left by other
    // suites must not conceal a writer requiring extra permissions.
    for (const table of ['branches', 'recipes', 'recipe_items', 'inventory_items', 'unit_conversions',
      'inventory_batches', 'inventory_movements', 'sales_entries', 'sales_consumption_identities', 'sales_consumption_revisions']) {
      const cols = await tx.execute<{ name: string }>(sql`SELECT quote_ident(attname) AS name FROM pg_attribute
        WHERE attrelid=${`public.${table}`}::regclass AND attnum>0 AND NOT attisdropped`);
      await tx.execute(sql.raw(`REVOKE ALL PRIVILEGES ON public.${table} FROM pulso_app`));
      await tx.execute(sql.raw(`REVOKE ALL PRIVILEGES (${cols.rows.map(c => c.name).join(',')}) ON public.${table} FROM pulso_app`));
    }
    for (const file of ['0137_inv01a_sale_consumption_identity.sql', '0138_inv01b_recipe_reader.sql', '0139_inv01b_application_scope.sql'])
      await tx.execute(sql.raw(readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint').at(-1)!));
    await tx.execute(sql.raw(readFileSync('drizzle/0141_inv01b_import_recipe_name.sql', 'utf8')));
    const login = async (index = 0) => {
      fixture.headers = new Headers();
      const response = await fetch(`${baseURL}/api/auth/sign-in/email`, { method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ email: `${actor[index]}@example.invalid`, password }) });
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      expect(cookie.length).toBeGreaterThan(0);
      fixture.headers = new Headers({ cookie });
      expect((await auth.api.getSession({ headers: fixture.headers }))?.user.id).toBe(actor[index]);
    };
    await check(tx, { company, branch, recipe, batch, login,
      bulk: (csvText, branchId = branch[0]) => fetch(`${baseURL}${endpoint}/bulk`, { method: 'POST',
        headers: { cookie: fixture.headers.get('cookie') ?? '', 'content-type': 'application/json' },
        body: JSON.stringify({ branchId, csvText, defaultDay: day,
          mapping: { recipeRef: 'Recipe', productKey: 'SKU', quantitySold: 'Qty', totalRevenue: 'Revenue' } }) }),
      post: (sales, branchId = branch[0]) =>
      fetch(`${baseURL}${endpoint}`, { method: 'POST', headers: { cookie: fixture.headers.get('cookie') ?? '', 'content-type': 'application/json' },
        body: JSON.stringify({ branchId, saleDate: day, sales }) }) });
    throw rollback;
  }, { isolationLevel: 'serializable' }); } catch (error) { if (error !== rollback) failure = error; }
  finally { fixture.tx = null; fixture.headers = new Headers(); }
  for (const id of company) expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  for (const id of actor) expect(await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, id))).toEqual([]);
  if (failure) throw failure;
}

async function state(tx: Tx, f: Scope) {
  await tx.execute(sql`SELECT set_config('app.current_company_id', ${f.company[0]}, true), set_config('app.current_branch_id', ${f.branch[0]}, true)`);
  return { stock: (await tx.select({ quantity: inventoryBatches.currentQuantity }).from(inventoryBatches).where(eq(inventoryBatches.id, f.batch[0])))[0].quantity,
    movements: await tx.select().from(inventoryMovements).where(eq(inventoryMovements.branchId, f.branch[0])),
    identities: await tx.select().from(salesConsumptionIdentities).where(eq(salesConsumptionIdentities.companyId, f.company[0])),
    revisions: await tx.select().from(salesConsumptionRevisions).where(eq(salesConsumptionRevisions.companyId, f.company[0])).orderBy(salesConsumptionRevisions.revision),
    sales: await tx.select().from(salesEntries).where(eq(salesEntries.companyId, f.company[0])) };
}

it('manual HTTP with real login: 10→12→8, retry, revenue completion and zero restore stock', async () => {
  await probe(async (tx, f) => {
    await f.login();
    const submit = async (quantitySold: number, totalRevenue?: number) => {
      const response = await f.post([{ recipeId: f.recipe[0], quantitySold, ...(totalRevenue === undefined ? {} : { totalRevenue }) }]);
      expect(response.status).toBe(200); return response.json();
    };
    expect(await submit(10)).toMatchObject({ inserted: 1, revenueComplete: false });
    expect((await state(tx, f)).stock).toBe('10.0000');
    expect(await submit(12)).toMatchObject({ updated: 1 });
    expect((await state(tx, f)).stock).toBe('8.0000');
    expect(await submit(8)).toMatchObject({ updated: 1 });
    const beforeRetry = await state(tx, f);
    expect(beforeRetry.stock).toBe('12.0000');
    expect(beforeRetry.revisions.map(row => row.totalRevenue)).toEqual([null, null, null]);
    expect(await submit(8)).toMatchObject({ skipped: 1 });
    expect(await state(tx, f)).toEqual(beforeRetry);
    expect(await submit(8, 80)).toMatchObject({ updated: 1, revenueComplete: true });
    const completed = await state(tx, f);
    expect(completed.movements).toEqual(beforeRetry.movements);
    expect(completed.sales[0]).toMatchObject({ quantitySold: '8.00', totalRevenue: 8000 });
    expect(await submit(0, 0)).toMatchObject({ updated: 1, revenueComplete: true });
    const cancelled = await state(tx, f);
    expect(cancelled.stock).toBe('20.0000');
    expect(cancelled.revisions).toHaveLength(5);
    expect(cancelled.identities[0]).toMatchObject({ source: 'manual:recipe', productKey: f.recipe[0], saleDay: day });
    expect(fixture.runtimeCalls).toBe(6);
  });
}, 180_000);

it('manual HTTP: insufficient stock and foreign recipe roll back the whole batch; manager can recover', async () => {
  await probe(async (tx, f) => {
    await f.login(1);
    const before = await state(tx, f);
    for (const [recipeId, quantitySold, status] of [[f.recipe[1], 21, 409], [f.recipe[2], 1, 400]] as const) {
      const response = await f.post([{ recipeId: f.recipe[0], quantitySold: 2 }, { recipeId, quantitySold }]);
      expect(response.status).toBe(status);
      expect(await state(tx, f)).toEqual(before);
    }
    expect((await f.post([{ recipeId: f.recipe[0], quantitySold: 2 }], f.branch[1])).status).toBe(403);
    expect(await state(tx, f)).toEqual(before);
    expect((await f.post([{ recipeId: f.recipe[0], quantitySold: 2 }])).status).toBe(200);
    expect((await state(tx, f)).stock).toBe('18.0000');
  });
}, 180_000);

it('manual HTTP: anonymous, employee, unassigned manager and cross-company branches cannot write', async () => {
  await probe(async (tx, f) => {
    const before = await state(tx, f), sales = [{ recipeId: f.recipe[0], quantitySold: 1 }];
    expect((await f.post(sales)).status).toBe(401);
    for (const index of [2, 3]) { await f.login(index); expect((await f.post(sales)).status).toBe(403); }
    await f.login();
    expect((await f.post(sales, f.branch[2])).status).toBe(400);
    await f.login(4);
    expect((await f.post(sales)).status).toBe(400);
    expect(await state(tx, f)).toEqual(before);
    expect(fixture.runtimeCalls).toBe(0);
  });
}, 180_000);

it('manual HTTP: unproven historical sales stay pending instead of silently consuming again', async () => {
  await probe(async (tx, f) => {
    await tx.insert(salesEntries).values({ companyId: f.company[0], branchId: f.branch[0], recipeId: f.recipe[0],
      quantitySold: '2', totalRevenue: 200, saleDate: new Date(`${day}T00:00:00Z`) });
    await f.login();
    const before = await state(tx, f);
    const response = await f.post([{ recipeId: f.recipe[0], quantitySold: 3 }]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PENDING_RECOVERY' });
    expect(await state(tx, f)).toEqual(before);
  });
}, 180_000);

it('manual HTTP: malformed JSON is a client error and leaves stock untouched', async () => {
  await probe(async (tx, f) => {
    await f.login();
    const before = await state(tx, f);
    const response = await fetch(`${baseURL}${endpoint}`, { method: 'POST',
      headers: { cookie: fixture.headers.get('cookie') ?? '', 'content-type': 'application/json' }, body: '{' });
    expect(response.status).toBe(400);
    expect(await state(tx, f)).toEqual(before);
    expect(fixture.runtimeCalls).toBe(0);
  });
}, 180_000);

it('bulk HTTP with real login: POS identity, correction, retry and revenue-only completion', async () => {
  await probe(async (tx, f) => {
    await f.login();
    const submit = async (quantity: number, revenue = '') => {
      const response = await f.bulk(`SKU,Recipe,Qty,Revenue\nPOS-01,${f.recipe[0]},${quantity},${revenue}`);
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.errors).toEqual([]);
      return result;
    };
    expect(await submit(10)).toMatchObject({ inserted: 1, revenueComplete: false });
    expect((await state(tx, f)).stock).toBe('10.0000');
    expect(await submit(8)).toMatchObject({ updated: 1, revenueComplete: false });
    const corrected = await state(tx, f);
    expect(corrected.stock).toBe('12.0000');
    expect(corrected.identities).toHaveLength(1);
    expect(corrected.identities[0]).toMatchObject({ source: 'pos:import', productKey: 'POS-01', saleDay: day });
    expect(await submit(8)).toMatchObject({ skipped: 1, revenueComplete: false });
    expect(await state(tx, f)).toEqual(corrected);
    expect(await submit(8, '80.25')).toMatchObject({ updated: 1, revenueComplete: true });
    const completed = await state(tx, f);
    expect(completed.movements).toEqual(corrected.movements);
    expect(completed.sales[0]).toMatchObject({ quantitySold: '8.00', totalRevenue: 8025 });
    expect(await submit(0, '0')).toMatchObject({ updated: 1, revenueComplete: true });
    expect((await state(tx, f)).stock).toBe('20.0000');
    expect(fixture.runtimeCalls).toBe(5);
  });
}, 180_000);

it('bulk HTTP: session, branch and company boundaries reject writes without consumption', async () => {
  await probe(async (tx, f) => {
    const csv = `SKU,Recipe,Qty,Revenue\nPOS-01,${f.recipe[0]},1,0`;
    const before = await state(tx, f);
    expect((await f.bulk(csv)).status).toBe(401);
    for (const index of [2, 3]) { await f.login(index); expect((await f.bulk(csv)).status).toBe(403); }
    await f.login(1);
    expect((await f.bulk(csv, f.branch[1])).status).toBe(403);
    await f.login();
    expect((await f.bulk(csv, f.branch[2])).status).toBe(403);
    for (const body of ['{', '']) {
      const response = await fetch(`${baseURL}${endpoint}/bulk`, { method: 'POST',
        headers: { cookie: fixture.headers.get('cookie') ?? '', 'content-type': 'application/json' }, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'El cuerpo debe contener JSON válido.' });
    }
    expect(await state(tx, f)).toEqual(before);
  });
}, 180_000);

it('manual and bulk HTTP: configured owner runtime is rejected with 503 without falling back', async () => {
  await probe(async (tx, f) => {
    await f.login();
    const before = await state(tx, f);
    vi.stubEnv('SALES_RUNTIME_DATABASE_URL', process.env.TEST_DATABASE_URL!);
    try {
      const responses = [await f.post([{ recipeId: f.recipe[0], quantitySold: 1 }]),
        await f.bulk(`SKU,Recipe,Qty,Revenue\nPOS-01,${f.recipe[0]},1,0`)];
      for (const response of responses) {
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'No se pudo habilitar el registro de ventas. Inténtalo de nuevo o contacta al administrador.' });
      }
      expect(await state(tx, f)).toEqual(before);
      expect(fixture.runtimeCalls).toBe(0);
    } finally { vi.unstubAllEnvs(); }
  });
}, 180_000);
