import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import ws from 'ws';
import type { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { ApiError } from '@/lib/api/error';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const unavailable = () => new ApiError('No se pudo habilitar el registro de ventas. Inténtalo de nuevo o contacta al administrador.', 503);

function runtimeUrl(value: string) {
  try {
    const runtime = new URL(value), owner = new URL(process.env.DATABASE_URL!);
    const host = (url: URL) => url.hostname.replace(/-pooler(?=\.)/, '');
    if (!['postgres:', 'postgresql:'].includes(runtime.protocol) || !runtime.username || !runtime.password
      || decodeURIComponent(runtime.username) === decodeURIComponent(owner.username)
      || host(runtime) !== host(owner) || (runtime.port || '5432') !== (owner.port || '5432')
      || decodeURIComponent(runtime.pathname) !== decodeURIComponent(owner.pathname)) throw unavailable();
    return runtime;
  } catch { throw unavailable(); }
}

/**
 * Explicit staged activation for the sales writer only. Missing env preserves
 * the current connection; a configured but invalid runtime never falls back.
 * Auth and other domains retain their own database boundary.
 * Pool/Client WebSocket transactions: https://github.com/neondatabase/serverless
 */
export async function withSalesWriterTransaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
  const configured = process.env.SALES_RUNTIME_DATABASE_URL;
  if (configured === undefined) {
    const { db } = await import('@/lib/db');
    return db.transaction(run, { isolationLevel: 'serializable' });
  }
  const url = runtimeUrl(configured);
  neonConfig.webSocketConstructor = ws;
  // Lifetime is one ingest attempt, including on serverless runtimes. No pool
  // shared between owners/runtime credentials or across Next bundles/reloads.
  const pool = new Pool({ connectionString: url.toString(), max: 1, allowExitOnIdle: true,
    connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
  pool.on('error', () => console.error('[sales-runtime] pooled connection error'));
  let started = false;
  try {
    return await drizzle(pool, { schema }).transaction(async tx => {
      const role = (await tx.execute<{
        current_user: string; session_user: string; rolbypassrls: boolean; rolsuper: boolean;
        rolcreaterole: boolean; rolcreatedb: boolean; memberships: number; table_count: number; rls: boolean; owns_tables: boolean;
      }>(sql`SELECT current_user, session_user, r.rolbypassrls, r.rolsuper, r.rolcreaterole, r.rolcreatedb,
        (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
        (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname IN ('recipes','recipe_items','inventory_items','unit_conversions',
            'inventory_batches','inventory_movements','sales_entries','sales_consumption_identities','sales_consumption_revisions')) AS table_count,
        (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname IN ('recipes','recipe_items','inventory_items','unit_conversions',
            'inventory_batches','inventory_movements','sales_entries','sales_consumption_identities','sales_consumption_revisions')) AS rls,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relowner=r.oid AND c.relname IN ('branches','recipes','recipe_items','inventory_items',
            'unit_conversions','inventory_batches','inventory_movements','sales_entries','sales_consumption_identities','sales_consumption_revisions')) AS owns_tables
        FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
      if (!role || role.current_user !== decodeURIComponent(url.username) || role.session_user !== role.current_user
        || role.rolbypassrls || role.rolsuper || role.rolcreaterole || role.rolcreatedb || role.memberships !== 0
        || role.table_count !== 9 || role.rls !== true || role.owns_tables) throw unavailable();
      started = true;
      return run(tx);
    }, { isolationLevel: 'serializable' });
  } catch (error) {
    // Do not expose connection strings/driver errors while connecting or
    // checking the role. Preserve callback/commit errors for business handling
    // and the ingest service's bounded serialization retries.
    if (!started) throw unavailable();
    throw error;
  } finally {
    await pool.end().catch(() => console.error('[sales-runtime] pool shutdown error'));
  }
}
