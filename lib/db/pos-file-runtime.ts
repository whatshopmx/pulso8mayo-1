import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import ws from 'ws';
import type { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { ApiError } from '@/lib/api/error';
import { setTenantContext, withCompanyContext, type TenantScope } from './tenant-context';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const unavailable = () => new ApiError('No se pudo habilitar el acceso al archivo POS. Inténtalo de nuevo o contacta al administrador.', 503);

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

/** Explicit activation for POS file reads/links only; auth and other readers
 * keep their own boundary. Invalid activation never retries with the owner.
 * A supplied client preserves the existing isolated SQL-test seam. */
export async function withPosFileContext<T>(scope: TenantScope, run: (tx: Transaction) => Promise<T>, client?: typeof db): Promise<T> {
  if (client) return withCompanyContext(scope, run, client);
  const configured = process.env.POS_FILES_RUNTIME_DATABASE_URL;
  if (configured === undefined) return withCompanyContext(scope, run);
  if (!scope.companyId?.trim()) throw new Error('setTenantContext: companyId es obligatorio.');
  const url = runtimeUrl(configured);
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url.toString(), max: 1, allowExitOnIdle: true,
    connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
  pool.on('error', () => console.error('[pos-file-runtime] pooled connection error'));
  let started = false;
  try {
    return await drizzle(pool, { schema }).transaction(async tx => {
      const role = (await tx.execute<{
        current_user: string; session_user: string; rolsuper: boolean; rolbypassrls: boolean;
        rolcreaterole: boolean; rolcreatedb: boolean; memberships: number;
        rls: boolean; owns_tables: boolean; limited: boolean; has_columns: boolean;
      }>(sql`SELECT current_user, session_user, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
        (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
        (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname='daily_sales_cuts') AS rls,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relowner=r.oid AND c.relname IN ('daily_sales_cuts','branches')) AS owns_tables,
        (NOT has_table_privilege(current_user,'public.daily_sales_cuts','SELECT,UPDATE,INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.daily_sales_cuts'::regclass
            AND a.attnum>0 AND NOT a.attisdropped AND (
              (has_column_privilege(current_user,a.attrelid,a.attnum,'SELECT') AND a.attname NOT IN ('id','company_id','branch_id','business_date','raw_file_url'))
              OR (has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE') AND a.attname NOT IN ('raw_file_url','validation_notes','updated_at'))
              OR has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT,REFERENCES')))) AS limited,
        ((SELECT bool_and(has_column_privilege(current_user,'public.daily_sales_cuts',p.col,p.permission))
          FROM (VALUES ('id','SELECT'),('company_id','SELECT'),('branch_id','SELECT'),('business_date','SELECT'),
            ('raw_file_url','SELECT'),('raw_file_url','UPDATE'),('validation_notes','UPDATE'),('updated_at','UPDATE')) p(col,permission))
          AND has_column_privilege(current_user,'public.branches','id','SELECT')
          AND has_column_privilege(current_user,'public.branches','company_id','SELECT')) AS has_columns
        FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
      if (!role || role.current_user !== decodeURIComponent(url.username) || role.session_user !== role.current_user
        || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.memberships !== 0
        || role.rls !== true || role.owns_tables || role.limited !== true || role.has_columns !== true) throw unavailable();
      await setTenantContext(tx, scope);
      started = true;
      return run(tx);
    });
  } catch (error) {
    if (!started) throw unavailable();
    throw error;
  } finally {
    await pool.end().catch(() => console.error('[pos-file-runtime] pool shutdown error'));
  }
}
