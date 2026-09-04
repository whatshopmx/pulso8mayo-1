import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { maskSensitive } from "@/lib/rbac/masking";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { getAccountsPayable } from "@/lib/services/accounts-payable-service";

/**
 * GET /api/finance/payables — lo que se debe, con antigüedad.
 *
 * Solo lectura, a propósito.
 *
 * Esta ruta tuvo brevemente un POST que marcaba una partida como pagada de un
 * clic, con permiso de GERENTE. Se retiró: el módulo de tesorería
 * (`docs/plan-cuentas-por-pagar-reconciliado.md`) define que un pago pasa por
 * regla de umbral, doble firma cuando aplica, lote con la CLABE del proveedor
 * verificada y congelada al cierre, y conciliación contra el movimiento
 * bancario. Un botón que salta los cuatro controles no es una versión reducida
 * de eso: es la ausencia del control que el módulo existe para vender.
 *
 * El registro de pagos vuelve con el flujo completo (paso 5 del plan).
 *
 * `branchId` viaja como `targetBranchId` para que ABAC pueda 403 a un rol
 * acotado a sucursal que pase la de otra, igual que `/api/finance/kpis`.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;
    const supplierId = searchParams.get("supplierId") || undefined;
    const payeeId = searchParams.get("payeeId") || undefined;

    const { ctx, decision } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      targetBranchId: branchId,
      audit: { action: "READ", req },
    });

    // Ver `kpis`: omitir `branchId` dejaba el agregado sin filtro para un rol
    // acotado a sucursal.
    const alcance = resolveBranchScope(ctx.userRole, ctx.userBranchId, branchId);

    // Un saldo por pagar en cero no se lee como "no hay datos": se lee como
    // "no debes nada", que es una afirmación sobre el dinero de alguien.
    if (alcance.kind === "NONE") {
      throw ApiError.forbidden("Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una para ver esta información.");
    }

    // A19 — El detalle se acota; los agregados siguen calculándose sobre todas
    // las partidas dentro del servicio, así que ni los totales ni los tramos de
    // antigüedad cambian. `limit` permite ampliarlo desde la URL, con tope.
    const limitPedido = Number(searchParams.get("limit"));
    const itemsLimit =
      Number.isInteger(limitPedido) && limitPedido > 0 && limitPedido <= 1000
        ? limitPedido
        : undefined;

    const payables = await getAccountsPayable({
      companyId: ctx.userCompanyId,
      branchId: alcance.kind === "BRANCH" ? alcance.branchId : undefined,
      supplierId,
      payeeId,
      itemsLimit,
    });

    return ApiHandler.success(maskSensitive(payables, decision));
  } catch (error) {
    return ApiHandler.error(error);
  }
}
