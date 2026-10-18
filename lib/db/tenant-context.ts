/**
 * SEC-04 (Fase 2) — contexto de tenant ligado a la transacción.
 *
 * Frontera de aislamiento en Postgres (RLS) para el dominio piloto `evidence`:
 * la política compara `company_id` contra `current_setting('app.current_company_id')`.
 * El ajuste se hace con `set_config(..., is_local => true)`, así que su alcance
 * es la TRANSACCIÓN: al terminar (commit o rollback) Postgres revierte el valor
 * y una conexión reutilizada del pool nunca hereda la empresa de la petición
 * anterior. Es exactamente el requisito SEC-04 (1).
 *
 * Reglas:
 * - Sin `companyId` la función lanza ANTES de tocar la base (rechazo por
 *   defecto); con RLS el rol de runtime tampoco ve filas si el ajuste falta.
 * - El rol de runtime debe ser NOBYPassrls y no dueño de la tabla; el rol de
 *   migración (dueño) queda separado y no depende de este helper.
 * - Los jobs/tareas programadas que no traen sesión HTTP llaman a
 *   `withCompanyContext` con el `companyId` explícito del evento, en vez de
 *   asumir un alcance privilegiado (SEC-04 (3)).
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import type { DbExecutor } from "@/lib/services/fefo-allocator";

/** Nombres de los ajustes de sesión que leen las políticas RLS. */
export const TENANT_SETTINGS = {
  companyId: "app.current_company_id",
  branchId: "app.current_branch_id",
  actorId: "app.current_actor_id",
} as const;

export interface TenantScope {
  companyId: string;
  branchId?: string | null;
  actorId?: string | null;
}

/** El `tx` que entrega `db.transaction` — derivado, sin `any`. */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Aplica el contexto de tenant al `executor` dado (una transacción abierta o
 * `db` directo). Con `db` directo el ajuste dura la conexión: úsalo sólo en
 * jobs de un solo tenant; para peticiones HTTP usa `withCompanyContext`.
 */
export async function setTenantContext(
  executor: DbExecutor,
  scope: TenantScope,
): Promise<void> {
  const companyId = scope.companyId?.trim();
  if (!companyId) {
    throw new Error(
      "setTenantContext: companyId es obligatorio; no se consulta sin contexto de empresa.",
    );
  }

  await executor.execute(
    sql`select set_config(${TENANT_SETTINGS.companyId}, ${companyId}, true)`,
  );
  if (scope.branchId) {
    await executor.execute(
      sql`select set_config(${TENANT_SETTINGS.branchId}, ${scope.branchId}, true)`,
    );
  }
  if (scope.actorId) {
    await executor.execute(
      sql`select set_config(${TENANT_SETTINGS.actorId}, ${scope.actorId}, true)`,
    );
  }
}

/**
 * Ejecuta `fn` dentro de una transacción con el contexto de empresa fijado.
 *
 * El ajuste se revierte al cerrar la transacción, de modo que es seguro con el
 * pool compartido de Neon (`lib/db/index.ts`). `client` permite probar con un
 * pool de rol runtime distinto del de migración (ver SEC-04).
 */
export async function withCompanyContext<T>(
  scope: TenantScope,
  fn: (tx: DbTransaction) => Promise<T>,
  client: typeof db = db,
): Promise<T> {
  return client.transaction(async (tx) => {
    await setTenantContext(tx, scope);
    return fn(tx);
  });
}

/**
 * Igual que `withCompanyContext`, pero resolviendo la empresa a partir de la
 * sucursal. Sirve a los servicios y reportes del dominio que sólo reciben
 * `branchId` y hoy dependían del bypass del dueño.
 *
 * La lectura de `branches` va DENTRO de la transacción del tenant: `branches`
 * todavía no tiene RLS, así que la resolución es posible sin contexto previo.
 */
export async function withBranchContext<T>(
  branchId: string,
  fn: (tx: DbTransaction) => Promise<T>,
  client: typeof db = db,
): Promise<T> {
  return client.transaction(async (tx) => {
    const [branch] = await tx
      .select({ companyId: branches.companyId })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    const companyId = branch?.companyId;
    if (!companyId) {
      throw new Error(
        `withBranchContext: la sucursal ${branchId} no existe o no tiene empresa; no se consulta sin contexto.`,
      );
    }

    await setTenantContext(tx, { companyId, branchId });
    return fn(tx);
  });
}
