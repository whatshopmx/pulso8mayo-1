import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { exceptions } from "@/lib/db/schema";
import { resolveBranchScope, type BranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import type { ExceptionRow } from "@/lib/services/exception-service";

/**
 * Alcance de sucursal para consultas de `exceptions`.
 *
 * GERENTE y SUPERVISOR quedan pinneados a su sucursal; el resto ve la empresa.
 * Un rol de sucursal sin `branchId` → `NONE` (fail-closed).
 */
export function exceptionBranchScope(
  role: Role,
  userBranchId: string | null | undefined,
): BranchScope {
  return resolveBranchScope(role, userBranchId, null);
}

/**
 * Carga una excepción del tenant, respetando el alcance de sucursal.
 *
 * Devuelve `null` si no existe, si es de otra empresa o si está fuera de la
 * sucursal del actor: desde fuera no se distingue un id inexistente de uno
 * ajeno (la ruta responde 404 en ambos casos).
 */
export async function findExceptionForTenant(
  id: string,
  tenantId: string,
  branchScope: BranchScope = { kind: "ALL" },
): Promise<ExceptionRow | null> {
  if (branchScope.kind === "NONE") return null;

  const conditions = [
    eq(exceptions.id, id),
    eq(exceptions.companyId, tenantId),
  ];
  if (branchScope.kind === "BRANCH") {
    conditions.push(eq(exceptions.branchId, branchScope.branchId));
  }

  const [row] = await db
    .select()
    .from(exceptions)
    .where(and(...conditions))
    .limit(1);

  return row ?? null;
}
