import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ owner: vi.fn(), runtime: vi.fn(), execute: vi.fn(), open: vi.fn(), close: vi.fn(), on: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { transaction: f.owner } }));
vi.mock('@neondatabase/serverless', () => ({ neonConfig: {}, Pool: class {
  constructor(options: unknown) { f.open(options); }
  on = f.on; end = f.close;
} }));
vi.mock('drizzle-orm/neon-serverless', () => ({ drizzle: () => ({ transaction: f.runtime }) }));
import { withSalesWriterTransaction } from '@/lib/db/sales-runtime';
import { SalesIngestService } from '@/lib/services/sales-ingest-service';

const ownerUrl = 'postgresql://owner:synthetic@ep-example.neon.tech/neondb';
const runtimeUrl = 'postgresql://writer:synthetic@ep-example-pooler.neon.tech/neondb';
const allowed = { current_user: 'writer', session_user: 'writer', rolbypassrls: false, rolsuper: false,
  rolcreaterole: false, rolcreatedb: false, memberships: 0, table_count: 9, rls: true, owns_tables: false };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('DATABASE_URL', ownerUrl); vi.stubEnv('SALES_RUNTIME_DATABASE_URL', runtimeUrl);
  f.close.mockResolvedValue(undefined);
  f.execute.mockResolvedValue({ rows: [allowed] });
  f.runtime.mockImplementation(async run => run({ execute: f.execute }));
  f.owner.mockImplementation(async run => run({ owner: true }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('explicit runtime uses a serializable transaction, checks role before callback and closes the pool', async () => {
  const run = vi.fn(async () => 'saved');
  expect(await withSalesWriterTransaction(run)).toBe('saved');
  expect(f.open).toHaveBeenCalledWith(expect.objectContaining({ connectionString: runtimeUrl }));
  expect(f.runtime).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'serializable' });
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.execute.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
  expect(f.close).toHaveBeenCalledTimes(1); expect(f.owner).not.toHaveBeenCalled();
});
it('without activation preserves the existing database transaction', async () => {
  vi.stubEnv('SALES_RUNTIME_DATABASE_URL', undefined);
  expect(await withSalesWriterTransaction(async tx => tx)).toEqual({ owner: true });
  expect(f.owner).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'serializable' });
  expect(f.open).not.toHaveBeenCalled();
});
it('blank, malformed, foreign database or owner credentials fail before opening any connection', async () => {
  for (const value of ['', ' ', 'not-a-url', ownerUrl, runtimeUrl.replace('neondb', 'other'), runtimeUrl.replace('ep-example', 'ep-foreign')]) {
    vi.stubEnv('SALES_RUNTIME_DATABASE_URL', value);
    await expect(withSalesWriterTransaction(vi.fn())).rejects.toMatchObject({ statusCode: 503 });
  }
  expect(f.open).not.toHaveBeenCalled(); expect(f.owner).not.toHaveBeenCalled();
});
it('unsafe role, owner table or missing RLS fails closed without running the writer', async () => {
  for (const changes of [{ rolbypassrls: true }, { rolsuper: true }, { rolcreaterole: true }, { rolcreatedb: true },
    { memberships: 1 }, { owns_tables: true }, { rls: false }, { table_count: 8 }, { session_user: 'owner' }, { current_user: 'owner' }]) {
    f.execute.mockResolvedValue({ rows: [{ ...allowed, ...changes }] });
    const run = vi.fn();
    await expect(withSalesWriterTransaction(run)).rejects.toMatchObject({ statusCode: 503 });
    expect(run).not.toHaveBeenCalled();
  }
  expect(f.close).toHaveBeenCalledTimes(10); expect(f.owner).not.toHaveBeenCalled();
});
it('connection failure is sanitized, closes its pool and never falls back to owner', async () => {
  f.runtime.mockRejectedValue(new Error(`could not connect ${runtimeUrl}`));
  await expect(withSalesWriterTransaction(vi.fn())).rejects.toMatchObject({ statusCode: 503,
    message: 'No se pudo habilitar el registro de ventas. Inténtalo de nuevo o contacta al administrador.' });
  expect(f.close).toHaveBeenCalledTimes(1); expect(f.owner).not.toHaveBeenCalled();
});
it('business and serialization failures survive the runtime boundary for rollback and retry', async () => {
  const failure = Object.assign(new Error('business rejection'), { code: '40001' });
  await expect(withSalesWriterTransaction(async () => { throw failure; })).rejects.toBe(failure);
  expect(f.close).toHaveBeenCalledTimes(1); expect(f.owner).not.toHaveBeenCalled();
});

it('ingest selects the runtime boundary and retries serialization at most three times without owner fallback', async () => {
  const ingest = vi.spyOn(SalesIngestService, 'ingestInTransaction').mockRejectedValue(Object.assign(new Error('retry'), { code: '40001' }));
  await expect(SalesIngestService.ingest({ companyId: 'company', branchId: 'branch', userId: 'actor', rows: [] })).rejects.toMatchObject({ code: '40001' });
  expect(ingest).toHaveBeenCalledTimes(3);
  expect(f.open).toHaveBeenCalledTimes(3); expect(f.close).toHaveBeenCalledTimes(3);
  expect(f.owner).not.toHaveBeenCalled();
});
