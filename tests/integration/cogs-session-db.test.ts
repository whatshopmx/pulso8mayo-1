import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { NextRequest } from 'next/server';

// Real auth, tenant resolution, service and SQL. Only Next request storage and
// the database transaction boundary are supplied by the rollback fixture.
const fixture = vi.hoisted(() => ({ tx: null as unknown, headers: new Headers() }));
vi.mock('@/lib/db', async original => {
  const actual = await original<typeof import('@/lib/db')>();
  return { db: new Proxy(actual.db, { get(target, key) {
    const source = fixture.tx ?? target;
    const value = Reflect.get(source as object, key);
    return typeof value === 'function' ? value.bind(source) : value;
  } }) };
});
vi.mock('next/headers', () => ({
  headers: async () => fixture.headers,
  cookies: async () => ({
    get: (name: string) => {
      const value = fixture.headers.get('cookie')?.split('; ').find(c => c.startsWith(`${name}=`))?.slice(name.length + 1);
      return value ? { value } : undefined;
    },
    set: () => {},
  }),
}));

import { db } from '@/lib/db';
import { account, users, sessions, branches, companies, recipes, salesEntries } from '@/lib/db/schema';
import { auth } from '@/lib/auth';
import { GET } from '@/app/api/inventory/reports/cogs/route';

// Actual loopback HTTP transport, using production auth and report handlers.
// Next request-local headers/cookies are supplied above; no Next server or UI.
const server = createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [name, values] of Object.entries(req.headers)) {
      for (const value of Array.isArray(values) ? values : values ? [values] : []) headers.append(name, value);
    }
    fixture.headers = headers;
    const url = `http://localhost:3000${req.url}`;
    let response: Response;
    if (req.url?.startsWith('/api/auth/')) {
      let body = '';
      for await (const chunk of req) body += chunk.toString();
      response = await auth.handler(new Request(url, { method: req.method, headers, body: body || undefined }));
    } else {
      response = await GET(new NextRequest(url, { headers }));
    }
    res.statusCode = response.status;
    response.headers.forEach((value, name) => { if (name !== 'set-cookie') res.setHeader(name, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.statusCode = 500; res.end('Test server failed');
  }
});
let baseURL: string;
beforeAll(async () => {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, '');
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync('.env')).DATABASE_URL));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback test address');
  baseURL = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function probe(check: (f: { company: string[]; branch: string[]; login: (index: number) => Promise<void> }) => Promise<void>) {
  const company = [randomUUID(), randomUUID()], branch = [randomUUID(), randomUUID(), randomUUID()];
  const actors = [randomUUID(), randomUUID(), randomUUID()];
  const recipe = randomUUID(), password = `Synthetic-${randomUUID()}`;
  const hash = await hashPassword(password), now = new Date();
  const rollback = new Error('COGS session fixture rollback');
  try {
    await db.transaction(async tx => {
      fixture.tx = tx;
      await tx.insert(companies).values(company.map(id => ({ id, name: 'Synthetic COGS session tenant' })));
      await tx.insert(branches).values(branch.map((id, n) => ({ id, companyId: company[n === 2 ? 1 : 0], name: 'Synthetic session branch' })));
      await tx.insert(recipes).values({ id: recipe, companyId: company[0], name: 'Synthetic legacy recipe', baseYield: '1', unit: 'PORTION' });
      await tx.insert(salesEntries).values({ companyId: company[0], branchId: branch[0], recipeId: recipe,
        quantitySold: '3', totalRevenue: 1200, saleDate: new Date('2026-11-16T00:00:00Z') });
      await tx.insert(users).values(actors.map((id, n) => ({ id, email: `${id}@example.invalid`, name: 'COGS test actor',
        emailVerified: true, companyId: company[0], branchId: n === 0 ? null : n === 1 ? branch[0] : null,
        role: n === 0 ? 'ADMIN' as const : 'GERENTE' as const, createdAt: now, updatedAt: now })));
      await tx.insert(account).values(actors.map(id => ({ id: randomUUID(), userId: id, accountId: id,
        providerId: 'credential', password: hash, createdAt: now, updatedAt: now })));
      async function login(index: number) {
        fixture.headers = new Headers();
        const response = await fetch(`${baseURL}/api/auth/sign-in/email`, {
          method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
          body: JSON.stringify({ email: `${actors[index]}@example.invalid`, password }),
        });
        expect(response.status).toBe(200);
        const cookies = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
        expect(cookies.length).toBeGreaterThan(0);
        fixture.headers = new Headers({ cookie: cookies });
        expect((await auth.api.getSession({ headers: fixture.headers }))?.user.id).toBe(actors[index]);
      }
      await check({ company, branch, login });
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { fixture.tx = null; fixture.headers = new Headers(); }
  for (const id of actors) {
    expect(await db.select({ id: users.id }).from(users).where(eq(users.id, id))).toEqual([]);
    expect(await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, id))).toEqual([]);
  }
  for (const id of company) expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
}

async function request(branchId: string) {
  return fetch(`${baseURL}/api/inventory/reports/cogs?branchId=${branchId}&startDate=2026-11-16&endDate=2026-11-16`, { headers: fixture.headers });
}

it('COGS with real sign-in: anonymous is 401; tenant spoof and foreign branch are 403', async () => {
  await probe(async f => {
    expect((await request(f.branch[0])).status).toBe(401);
    await f.login(0);
    const response = await request(f.branch[0]);
    expect(response.status).toBe(200);
    expect((await response.json()).report).toMatchObject({ reportedRevenueCents: 1200, revenueCents: null,
      foodCostPercent: null, revenueCoverage: { status: 'PARTIAL', totalEntries: 1 } });
    expect((await request(f.branch[2])).status).toBe(403);
    fixture.headers.set('x-pulso-tenant-id', f.company[1]);
    expect((await request(f.branch[2])).status).toBe(403);
    fixture.headers.delete('x-pulso-tenant-id');
    fixture.headers.set('cookie', fixture.headers.get('cookie')!.replace(/session_token=[^;]+/, 'session_token=invalid'));
    expect((await request(f.branch[0])).status).toBe(401);
  });
});

it('COGS with real sign-in: manager stays in assigned branch and missing assignment is denied', async () => {
  await probe(async f => {
    await f.login(1);
    const response = await request(f.branch[1]);
    expect(response.status).toBe(200);
    expect((await response.json()).report).toMatchObject({ branchId: f.branch[0], reportedRevenueCents: 1200 });
    await f.login(2);
    expect((await request(f.branch[0])).status).toBe(403);
  });
});
