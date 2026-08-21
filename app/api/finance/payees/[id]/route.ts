import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { deactivatePayee } from "@/lib/services/payee-service";

/** Ver la justificación completa en `app/api/finance/payees/route.ts`. */
const ROLES_FINANZAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

/**
 * DELETE /api/finance/payees/[id] — baja lógica de una contraparte.
 *
 * `active = false`: el catálogo deja de ofrecerla, pero los gastos históricos
 * que la referencian conservan el nombre congelado. No se borra nada.
 */
export const DELETE = withRoleAuth(
  [...ROLES_FINANZAS],
  async (_req, { params, auth }) => {
    try {
      const { id } = await params;
      const payee = await deactivatePayee(
        auth.tenantId,
        id,
        auth.user.id,
        auth.branchId ?? null
      );
      return ApiHandler.success(payee);
    } catch (error) {
      return ApiHandler.error(error);
    }
  }
);
