import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  BRANCH_COOKIE_NAME,
  BRANCH_SCOPE_ALL,
  BRANCH_SCOPE_COOKIE_NAME,
} from "@/lib/branch-cookies";
import { assertBranchOfCompany, canAccessAllBranches, resolveBranchScope, type BranchScope } from "@/lib/branch-scope";
import { ApiError } from '@/lib/api/error';
import type { Role } from "@/lib/permissions";

/**
 * Resuelve UNA sola vez el alcance de sucursal efectivo de una pantalla de
 * servidor.
 *
 * El encabezado escribe la sucursal en cookies, pero una pantalla que lee la
 * cookie directamente (`cookieBranch || params.branch`) trata la petición como
 * una autorización: un GERENTE de Condesa que abre `?branch=roma` ve Roma. La
 * regla de autorización ya existe en `lib/branch-scope.ts`; el problema era que
 * cada pantalla la aplicaba —o no— por su cuenta.
 *
 * Orden de precedencia: parámetro de la URL, cookie de sucursal, cookie
 * "Todas". Para GERENTE/SUPERVISOR todo eso se ignora y manda su sesión. Un
 * rol acotado sin sucursal recibe `NONE`, que los consumidores deben traducir a
 * "cero resultados", nunca a "sin filtro".
 */
export async function resolveRequestBranchScope(
  requestedBranchId?: string | null,
): Promise<BranchScope> {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user as
    | { role?: Role; branchId?: string | null; companyId?: string | null }
    | undefined;

  if (!user?.role || !user.companyId) return { kind: "NONE" };

  const cookieStore = await cookies();
  const scopeEsTodas =
    cookieStore.get(BRANCH_SCOPE_COOKIE_NAME)?.value === BRANCH_SCOPE_ALL;
  const cookieBranch = cookieStore.get(BRANCH_COOKIE_NAME)?.value ?? null;
  const requested = requestedBranchId || (scopeEsTodas ? null : cookieBranch);

  const scope = resolveBranchScope(user.role, user.branchId ?? null, requested);
  if (scope.kind !== 'BRANCH') return scope;
  try {
    await assertBranchOfCompany(user.companyId, scope.branchId);
    return scope;
  } catch (error) {
    // Una preferencia vieja de dirección se descarta. Una query explícita
    // inválida o una asignación ajena nunca se convierten en consolidado.
    if (error instanceof ApiError && error.statusCode === 400) {
      return !requestedBranchId && canAccessAllBranches(user.role) ? { kind: 'ALL' } : { kind: 'NONE' };
    }
    throw error; // Red/DB no se representa como "sin datos".
  }
}

/** Id de sucursal a pasar a una consulta, o `null` para "toda la empresa". */
export function scopeBranchId(scope: BranchScope): string | null {
  return scope.kind === "BRANCH" ? scope.branchId : null;
}
