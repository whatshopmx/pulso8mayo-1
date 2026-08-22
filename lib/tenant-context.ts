import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { ApiError } from "./api/error";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/schema";
import type { Role } from "./permissions";
import { BRANCH_COOKIE_NAME, BRANCH_SCOPE_ALL, BRANCH_SCOPE_COOKIE_NAME } from "./branch-cookies";

export const TENANT_HEADER = "x-pulso-tenant-id";
// Una sola definición, en un módulo sin dependencias: los componentes cliente
// no pueden importar de aquí (este módulo importa `db` y `auth`). Se re-exporta
// para no tocar a los cinco archivos que ya lo importan de esta ruta.
export { BRANCH_COOKIE_NAME } from "./branch-cookies";

export async function getCurrentTenant() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    throw ApiError.unauthorized();
  }

  // Try to get selected branch from cookie first (user's active selection)
  const cookieStore = await cookies();
  const selectedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value;

  /**
   * El alcance del tenant tiene que decir lo mismo que el encabezado.
   *
   * Antes era `selectedBranchId || user.branchId`, y eso rompía en los dos
   * extremos:
   *
   * - Con "Todas" la cookie **se borra**, así que este `||` caía a la sucursal
   *   de la sesión. Un ADMIN con sucursal colgada veía la pantalla anunciando
   *   "Todas" mientras cada ruta que usa `requireTenant().branchId` filtraba por
   *   una sola. La UI afirmaba un alcance que el servidor no aplicaba.
   * - Sin cookie y sin haber elegido, pasaba lo mismo en silencio.
   *
   * La regla es la de `lib/branch-scope.ts:82-85`, que es la que manda: a
   * `GERENTE` y `SUPERVISOR` los fija su sesión y se ignora lo que pidan; a los
   * demás, la sucursal pedida o **ninguna** — y ninguna significa la empresa
   * entera, no la sucursal que arrastre la sesión.
   */
  const alcanceEsTodas =
    cookieStore.get(BRANCH_SCOPE_COOKIE_NAME)?.value === BRANCH_SCOPE_ALL;
  const rol = (session.user as { role?: string }).role;
  const esFijadoASucursal = rol === "GERENTE" || rol === "SUPERVISOR";
  const sucursalDeLaSesion = (session.user as { branchId?: string }).branchId ?? null;

  const branchIdDelAlcance = esFijadoASucursal
    ? sucursalDeLaSesion
    : alcanceEsTodas
      ? null
      : selectedBranchId ?? null;

  // First, try to get tenant from header (for explicit tenant selection in the future)
  const headerTenantId = (await headers()).get(TENANT_HEADER);

  if (headerTenantId) {
    // Verify the user belongs to the requested tenant before accepting the header.
    // Until multi-tenant membership exists, the header must match the session's companyId.
    if (headerTenantId !== session.user.companyId) {
      throw ApiError.forbidden("You do not have access to the requested tenant.");
    }
    return {
      id: headerTenantId,
      userId: session.user.id,
      branchId: branchIdDelAlcance
    };
  }

  // Fall back to user's default company
  const user = session.user;
  if (user.companyId) {
    return {
      id: user.companyId,
      userId: session.user.id,
      branchId: branchIdDelAlcance
    };
  }

  // No tenant available
  return {
    id: null,
    userId: session.user.id,
    unassigned: true,
    branchId: null
  };
}

export async function requireTenant() {
  const tenant = await getCurrentTenant();
  if (!tenant?.id && !tenant?.unassigned) {
    throw ApiError.badRequest("Tenant header or selection is missing.");
  }
  return tenant;
}

/**
 * Get authenticated user with role information
 * Throws if not authenticated
 */
export async function requireAuth() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    throw ApiError.unauthorized();
  }

  return {
    user: session.user as { id: string; role: Role; companyId?: string | null; branchId?: string | null; email: string; name?: string },
    session: session.session,
  };
}
