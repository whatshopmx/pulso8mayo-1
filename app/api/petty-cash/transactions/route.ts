import { NextRequest } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { getPettyCashAuditHistory } from "@/lib/services/petty-cash-service";

/**
 * Bitácora de caja chica de una sucursal.
 *
 * Desde A17 la pantalla de Caja Chica ya no la usa: pide
 * `/api/petty-cash/consolidado`, que trae fondos y movimientos en una lectura.
 * Esta ruta se conserva para consultas puntuales por sucursal.
 *
 * El alcance se resolvió aquí de paso, porque tomaba `branchId` del query sin
 * pasarlo por la sesión: un GERENTE de Condesa podía leer el efectivo de
 * Polanco, y sin `branchId` recibía la cadena entera. La frontera de empresa sí
 * estaba (el servicio filtra por `company_id`); la de sucursal no.
 */
export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const { searchParams } = new URL(req.url);
    const pedida = searchParams.get("branchId") || undefined;

    const scope = resolveBranchScope(
      (user.role || "EMPLEADO") as never,
      user.branchId,
      pedida
    );

    // `NONE` niega: un rol acotado a sucursal sin sucursal asignada no debe
    // caer en el mismo `undefined` que significa "toda la empresa".
    if (scope.kind === "NONE") {
      throw ApiError.forbidden(
        "Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una para ver esta información."
      );
    }

    const history = await getPettyCashAuditHistory(tenant.id, {
      branchId: scope.kind === "BRANCH" ? scope.branchId : undefined,
    });
    return ApiHandler.success(history);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
