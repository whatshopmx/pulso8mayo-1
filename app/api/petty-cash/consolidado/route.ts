import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
import {
  getPettyCashConsolidado,
  PETTY_CASH_MOVIMIENTOS_LIMIT,
} from "@/lib/services/petty-cash-service";

/**
 * A17 — `GET /api/petty-cash/consolidado?branchId=`
 *
 * Reemplaza el abanico de 2×N peticiones que hacía la pantalla de Caja Chica:
 * una por sucursal para el fondo y otra para su bitácora. Con 15 sucursales
 * eran 30, cada una atravesando el limitador de tasa y una verificación de
 * sesión que es a su vez un `fetch` interno.
 *
 * El alcance sale de la sesión, como en el resto del módulo: `branchId` en el
 * query es una **petición**, no una orden, y `resolveBranchScope` la ignora
 * para un rol fijado a su sucursal. `NONE` devuelve vacío en vez de la cadena
 * entera.
 *
 * Devuelve también el `scope` que se aplicó. La pantalla no puede afirmar de
 * qué está hablando si no sabe qué alcance le tocó — es el mismo criterio de
 * A10 en Gastos.
 */
export const GET = withTenantAuth(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const pedida = searchParams.get("branchId") || undefined;

  const scope = resolveBranchScope(auth.user.role, auth.user.branchId, pedida);

  const limitParam = Number(searchParams.get("movimientosLimit"));
  const movimientosLimit =
    Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 500
      ? limitParam
      : PETTY_CASH_MOVIMIENTOS_LIMIT;

  const data = await getPettyCashConsolidado(auth.tenantId, scope, {
    movimientosLimit,
  });

  return ApiHandler.success({ ...data, scope });
});
