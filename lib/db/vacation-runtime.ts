import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import ws from "ws";
import type { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { ApiError, isApiError } from "@/lib/api/error";
import { setTenantContext, withCompanyContext } from "@/lib/db/tenant-context";
import type { VacationActor } from "@/lib/services/vacation-access";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const unavailable = () => new ApiError("No se pudo habilitar vacaciones. Inténtalo de nuevo o contacta al administrador.", 503);

function runtimeUrl(value: string): URL {
  try {
    const runtime = new URL(value), owner = new URL(process.env.DATABASE_URL!);
    const host = (url: URL) => url.hostname.replace(/-pooler(?=\.)/, "");
    if (!["postgres:", "postgresql:"].includes(runtime.protocol) || !runtime.username || !runtime.password
      || decodeURIComponent(runtime.username) === decodeURIComponent(owner.username)
      || decodeURIComponent(runtime.username) === "pulso_app"
      || host(runtime) !== host(owner) || (runtime.port || "5432") !== (owner.port || "5432")
      || decodeURIComponent(runtime.pathname) !== decodeURIComponent(owner.pathname)) throw unavailable();
    return runtime;
  } catch { throw unavailable(); }
}

/** Staged domain adoption, like the sales writer. Invalid explicit configuration
 * never falls back. Auth/catalogs retain their own connection and privileges. */
export async function withVacationTransaction<T>(user: VacationActor, run: (tx: Transaction, runtime: boolean) => Promise<T>): Promise<T> {
  if (!user.id || !user.companyId) throw ApiError.forbidden("Se requiere actor y empresa para vacaciones");
  const scope = { companyId: user.companyId, actorId: user.id, branchId: user.branchId };
  const configured = process.env.VACATIONS_RUNTIME_DATABASE_URL;
  if (configured === undefined) return withCompanyContext(scope, tx => run(tx, false));
  const url = runtimeUrl(configured);
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url.toString(), max: 1, allowExitOnIdle: true,
    connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
  pool.on("error", () => console.error("[vacation-runtime] pooled connection error"));
  let started = false;
  try {
    return await drizzle(pool, { schema }).transaction(async tx => {
      const role = (await tx.execute<{
        current_user: string; session_user: string; elevated: boolean; memberships: number;
        rls: boolean; owns_tables: boolean; catalog_access: boolean; extra_access: boolean;
        policies: number; scope_function: boolean; transition_guard: boolean; required_access: boolean;
      }>(sql`SELECT current_user, session_user,
        (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb) AS elevated,
        (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
        c.relrowsecurity AS rls,
        EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
          WHERE n.nspname='public' AND t.relowner=r.oid AND t.relname IN ('vacation_requests','users','branches')) AS owns_tables,
        (has_any_column_privilege(current_user,'public.users','SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege(current_user,'public.users','DELETE,TRUNCATE,TRIGGER')
          OR has_any_column_privilege(current_user,'public.branches','SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege(current_user,'public.branches','DELETE,TRUNCATE,TRIGGER')) AS catalog_access,
        (has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_schema_privilege(current_user,'public','CREATE')
          OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
            AND a.attname NOT IN ('status','approved_by','approved_at','rejected_by','rejected_at','cancelled_at',
              'manager_comments','rejection_reason','updated_at')
            AND has_column_privilege(current_user,c.oid,a.attname,'UPDATE'))) AS extra_access,
        (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid
          AND p.polname IN ('vacation_runtime_read','vacation_runtime_insert','vacation_runtime_update','vacation_payroll_read')) AS policies,
        EXISTS (SELECT 1 FROM pg_proc f WHERE f.oid=to_regprocedure('public.vacation_request_scope(uuid,uuid,text,text)')
          AND f.prosecdef AND f.proowner<>r.oid AND f.proconfig @> ARRAY['search_path=pg_catalog']
          AND has_function_privilege(current_user,f.oid,'EXECUTE')) AS scope_function,
        EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='vacation_request_transition_guard'
          AND t.tgenabled='O' AND NOT t.tgisinternal) AS transition_guard,
        (has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT')
          AND (SELECT bool_and(has_column_privilege(current_user,c.oid,col,'UPDATE'))
            FROM unnest(ARRAY['status','approved_by','approved_at','rejected_by','rejected_at','cancelled_at',
              'manager_comments','rejection_reason','updated_at']) AS col)) AS required_access
        FROM pg_roles r JOIN pg_class c ON c.oid=to_regclass('public.vacation_requests') WHERE r.rolname=current_user`)).rows[0];
      if (!role || role.current_user !== decodeURIComponent(url.username) || role.session_user !== role.current_user
        || role.elevated || role.memberships !== 0 || !role.rls || role.owns_tables || role.catalog_access || role.extra_access
        || role.policies !== 4 || !role.scope_function || !role.transition_guard || !role.required_access) throw unavailable();
      await setTenantContext(tx, scope);
      started = true;
      return run(tx, true);
    });
  } catch (error) {
    if (!started) throw unavailable();
    if (isApiError(error)) throw error;
    const failure = error as { code?: string; cause?: { code?: string } };
    const code = failure.cause?.code ?? failure.code;
    if (code === "42501") throw ApiError.forbidden("La operación de vacaciones ya no está permitida. Actualiza la pantalla.");
    if (code === "23514" || code === "23505") throw ApiError.conflict("La solicitud cambió o su transición ya no es válida. Actualiza la pantalla.");
    throw error;
  } finally { await pool.end().catch(() => console.error("[vacation-runtime] pool shutdown error")); }
}

/** Transacción dedicada para el historial inmutable de vacaciones (0164).
 * Si VACATIONS_RUNTIME_DATABASE_URL está configurada, valida RLS/FORCE, privilegios
 * mínimos (solo SELECT/INSERT, sin secuencia ni catálogo) y triggers antes de ejecutar.
 * Nunca hace fallback al propietario si la configuración es inválida. */
export async function withVacationHistoryTransaction<T>(
  user: VacationActor,
  run: (tx: Transaction, runtime: boolean) => Promise<T>,
): Promise<T> {
  if (!user.id || !user.companyId) throw ApiError.forbidden("Se requiere actor y empresa para el historial de vacaciones");
  const scope = { companyId: user.companyId, actorId: user.id, branchId: user.branchId };
  const configured = process.env.VACATIONS_RUNTIME_DATABASE_URL;
  if (configured === undefined) {
    try {
      return await withCompanyContext(scope, tx => run(tx, false));
    } catch (error) {
      if (isApiError(error)) throw error;
      const failure = error as { code?: string; cause?: { code?: string } };
      const code = failure.cause?.code ?? failure.code;
      if (code === "42501") throw ApiError.forbidden("La operación sobre el historial de vacaciones no está permitida.");
      if (code === "23514" || code === "23505") throw ApiError.conflict("Conflicto al registrar el historial de vacaciones. Actualiza e inténtalo de nuevo.");
      throw error;
    }
  }
  const url = runtimeUrl(configured);
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({
    connectionString: url.toString(), max: 1, allowExitOnIdle: true,
    connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000,
  });
  pool.on("error", () => console.error("[vacation-history-runtime] pooled connection error"));
  let started = false;
  try {
    return await drizzle(pool, { schema }).transaction(async tx => {
      const role = (await tx.execute<{
        current_user: string; session_user: string; elevated: boolean; memberships: number;
        rls_forced: boolean; owns_tables: boolean; catalog_access: boolean; extra_access: boolean;
        seq_access: boolean; policies: number; scope_function: boolean; triggers: number; required_access: boolean;
      }>(sql`SELECT current_user, session_user,
        (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb) AS elevated,
        (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
        (s.relrowsecurity AND s.relforcerowsecurity AND e.relrowsecurity AND e.relforcerowsecurity) AS rls_forced,
        EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
          WHERE n.nspname='public' AND t.relowner=r.oid
            AND t.relname IN ('vacation_history_streams','vacation_history_events','users','branches')) AS owns_tables,
        (has_any_column_privilege(current_user,'public.users','SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege(current_user,'public.users','DELETE,TRUNCATE,TRIGGER')
          OR has_any_column_privilege(current_user,'public.branches','SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege(current_user,'public.branches','DELETE,TRUNCATE,TRIGGER')) AS catalog_access,
        (has_table_privilege(current_user,s.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_table_privilege(current_user,e.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_schema_privilege(current_user,'public','CREATE')) AS extra_access,
        has_sequence_privilege(current_user,'public.vacation_history_record_version_seq','USAGE,SELECT,UPDATE') AS seq_access,
        (SELECT count(*)::int FROM pg_policy p WHERE (p.polrelid=s.oid AND p.polname IN ('vacation_history_stream_read','vacation_history_stream_insert'))
          OR (p.polrelid=e.oid AND p.polname IN ('vacation_history_event_read','vacation_history_event_insert'))) AS policies,
        EXISTS (SELECT 1 FROM pg_proc f WHERE f.oid=to_regprocedure('public.vacation_history_scope(uuid,text,text)')
          AND f.prosecdef AND f.proowner<>r.oid AND f.proconfig @> ARRAY['search_path=pg_catalog']
          AND has_function_privilege(current_user,f.oid,'EXECUTE')) AS scope_function,
        (SELECT count(*)::int FROM pg_trigger t WHERE t.tgenabled='O' AND NOT t.tgisinternal
          AND ((t.tgrelid=s.oid AND t.tgname IN ('vacation_history_stream_insert','vacation_history_stream_immutable','vacation_history_stream_no_truncate'))
            OR (t.tgrelid=e.oid AND t.tgname IN ('vacation_history_event_insert','vacation_history_event_immutable','vacation_history_event_no_truncate')))) AS triggers,
        (has_table_privilege(current_user,s.oid,'SELECT') AND has_table_privilege(current_user,s.oid,'INSERT')
          AND has_table_privilege(current_user,e.oid,'SELECT') AND has_table_privilege(current_user,e.oid,'INSERT')) AS required_access
        FROM pg_roles r
        JOIN pg_class s ON s.oid=to_regclass('public.vacation_history_streams')
        JOIN pg_class e ON e.oid=to_regclass('public.vacation_history_events')
        WHERE r.rolname=current_user`)).rows[0];
      if (!role || role.current_user !== decodeURIComponent(url.username) || role.session_user !== role.current_user
        || role.elevated || role.memberships !== 0 || !role.rls_forced || role.owns_tables
        || role.catalog_access || role.extra_access || role.seq_access
        || role.policies !== 4 || !role.scope_function || role.triggers !== 6 || !role.required_access) {
        throw unavailable();
      }
      await setTenantContext(tx, scope);
      started = true;
      return run(tx, true);
    });
  } catch (error) {
    if (!started) throw unavailable();
    if (isApiError(error)) throw error;
    const failure = error as { code?: string; cause?: { code?: string } };
    const code = failure.cause?.code ?? failure.code;
    if (code === "42501") throw ApiError.forbidden("La operación sobre el historial de vacaciones no está permitida.");
    if (code === "23514" || code === "23505") throw ApiError.conflict("Conflicto al registrar el historial de vacaciones. Actualiza e inténtalo de nuevo.");
    throw error;
  } finally { await pool.end().catch(() => console.error("[vacation-history-runtime] pool shutdown error")); }
}
