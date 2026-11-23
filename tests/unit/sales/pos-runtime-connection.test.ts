import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ owner: vi.fn(), runtime: vi.fn(), execute: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { transaction: f.owner } }));
vi.mock('@neondatabase/serverless', () => ({ neonConfig: {}, Pool: class {
  constructor(options: unknown) { f.open(options); }
  on() {} end = f.close;
} }));
vi.mock('drizzle-orm/neon-serverless', () => ({ drizzle: () => ({ transaction: f.runtime }) }));
import { withPosFileContext } from '@/lib/db/pos-file-runtime';
import { readPosCutFileRecord, linkPosCutFileRecord } from '@/lib/services/pos-cut-file-service';
const ownerUrl = 'postgresql://owner:synthetic@ep-example.neon.tech/neondb';
const runtimeUrl = 'postgresql://pos:synthetic@ep-example-pooler.neon.tech/neondb';
const scope = { companyId: 'company', branchId: 'branch', actorId: 'actor' };
const allowed = { current_user: 'pos', session_user: 'pos', rolsuper: false, rolbypassrls: false,
  rolcreaterole: false, rolcreatedb: false, memberships: 0, rls: true, owns_tables: false,
  limited: true, has_columns: true };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('DATABASE_URL', ownerUrl); vi.stubEnv('POS_FILES_RUNTIME_DATABASE_URL', runtimeUrl);
  f.close.mockResolvedValue(undefined); f.execute.mockResolvedValue({ rows: [allowed] });
  f.runtime.mockImplementation(async run => run({ execute: f.execute }));
  f.owner.mockImplementation(async run => run({ execute: f.execute, owner: true }));
});
afterEach(() => vi.unstubAllEnvs());
it('checks the independent role and sets tenant context before running the callback, then closes', async () => {
  const run = vi.fn(async () => 'linked');
  expect(await withPosFileContext(scope, run)).toBe('linked');
  expect(f.open).toHaveBeenCalledWith(expect.objectContaining({ connectionString: runtimeUrl, max: 1 }));
  expect(f.execute).toHaveBeenCalledTimes(4); // role + company/branch/actor
  expect(f.execute.mock.invocationCallOrder.at(-1)).toBeLessThan(run.mock.invocationCallOrder[0]);
  expect(f.close).toHaveBeenCalledTimes(1); expect(f.owner).not.toHaveBeenCalled();
});
it('preserves the transition when absent and explicit test clients without opening a runtime pool', async () => {
  vi.stubEnv('POS_FILES_RUNTIME_DATABASE_URL', undefined);
  expect(await withPosFileContext(scope, async tx => 'owner' in tx)).toBe(true);
  vi.stubEnv('POS_FILES_RUNTIME_DATABASE_URL', ownerUrl);
  const client = { transaction: f.owner } as never;
  expect(await withPosFileContext(scope, async () => 'supplied', client)).toBe('supplied');
  expect(f.open).not.toHaveBeenCalled();
});
it('rejects blank/malformed/foreign/owner URI before opening connections and never falls back', async () => {
  for (const value of ['', ' ', 'not-a-url', ownerUrl, runtimeUrl.replace('neondb', 'other'), runtimeUrl.replace('ep-example', 'ep-foreign'), runtimeUrl.replace('.tech/', '.tech:5433/')]) {
    vi.stubEnv('POS_FILES_RUNTIME_DATABASE_URL', value);
    await expect(withPosFileContext(scope, vi.fn())).rejects.toMatchObject({ statusCode: 503 });
  }
  expect(f.open).not.toHaveBeenCalled(); expect(f.owner).not.toHaveBeenCalled();
});
it('rejects unsafe roles, ownership, missing RLS/columns or broad grants before tenant/data queries', async () => {
  for (const changes of [{ rolsuper: true }, { rolbypassrls: true }, { rolcreaterole: true }, { rolcreatedb: true },
    { memberships: 1 }, { current_user: 'owner' }, { session_user: 'owner' }, { owns_tables: true },
    { rls: false }, { limited: false }, { has_columns: false }]) {
    f.execute.mockResolvedValue({ rows: [{ ...allowed, ...changes }] });
    const run = vi.fn();
    await expect(withPosFileContext(scope, run)).rejects.toMatchObject({ statusCode: 503 });
    expect(run).not.toHaveBeenCalled();
  }
  expect(f.execute).toHaveBeenCalledTimes(11); expect(f.close).toHaveBeenCalledTimes(11);
  expect(f.owner).not.toHaveBeenCalled();
});
it('sanitizes connection failures and preserves callback failures with pool cleanup', async () => {
  f.runtime.mockRejectedValueOnce(new Error(`failed ${runtimeUrl}`));
  await expect(withPosFileContext(scope, vi.fn())).rejects.toMatchObject({ statusCode: 503,
    message: 'No se pudo habilitar el acceso al archivo POS. Inténtalo de nuevo o contacta al administrador.' });
  const failure = new Error('callback failed');
  await expect(withPosFileContext(scope, async () => { throw failure; })).rejects.toBe(failure);
  expect(f.close).toHaveBeenCalledTimes(2); expect(f.owner).not.toHaveBeenCalled();
});
it('both POS services reject invalid activation instead of using the default owner', async () => {
  vi.stubEnv('POS_FILES_RUNTIME_DATABASE_URL', ownerUrl);
  await expect(readPosCutFileRecord(scope, 'cut')).rejects.toMatchObject({ statusCode: 503 });
  await expect(linkPosCutFileRecord({ ...scope, businessDate: '2026-11-22' }, 'key', 'notes')).rejects.toMatchObject({ statusCode: 503 });
  expect(f.owner).not.toHaveBeenCalled();
});
