import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { getLaborCostRatioByBranch } from "@/lib/services/labor-cost-service";
import { resolvePnlPeriod } from "@/lib/services/pnl-service";
import { getFinancialTargets } from "@/lib/services/tenant-config-service";
import type { LaborCostReport } from "@/lib/services/labor-cost-types";

/**
 * GET /api/finance/labor-cost?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=…
 *
 * Ratio de costo laboral sobre venta por sucursal, con la procedencia del
 * cálculo declarada por renglón (`MEASURED` / `CONTRACT_ONLY` / `NO_DATA`).
 *
 * Los objetivos del tenant viajan en la misma respuesta: el semáforo se pinta
 * en el cliente y pedirlos aparte abre la ventana en la que la tabla se
 * colorea contra una constante local mientras llega la config real.
 *
 * `from`/`to` es la firma del plan; se acepta `startDate`/`endDate` como alias
 * porque es la que usa `/api/finance/pnl` y las dos pantallas comparten el
 * selector de rango.
 */
export const GET = withTenantAuth(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || searchParams.get("startDate") || undefined;
  const to = searchParams.get("to") || searchParams.get("endDate") || undefined;

  // `resolveBranchScope` y no `enforceBranchScope`: el segundo devuelve `null`
  // tanto para "ve toda la empresa" como para "está acotado pero no tiene
  // sucursal asignada", y ese segundo caso terminaría mostrándole la nómina del
  // grupo entero a un GERENTE sin sucursal. Mismo criterio que /api/finance/pnl.
  const alcance = resolveBranchScope(
    auth.user.role,
    auth.user.branchId,
    searchParams.get("branchId"),
  );

  if (alcance.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una para ver el costo laboral.",
    );
  }

  const period = resolvePnlPeriod(from, to);

  const [todas, targets] = await Promise.all([
    getLaborCostRatioByBranch(auth.tenantId, period.startDate, period.endDate),
    getFinancialTargets(auth.tenantId),
  ]);

  // El alcance se aplica sobre el resultado: el servicio agrega por empresa en
  // consultas que no escalan con el número de sucursales, así que filtrar aquí
  // no cuesta una consulta extra.
  const branches =
    alcance.kind === "BRANCH" ? todas.filter((b) => b.branchId === alcance.branchId) : todas;

  const payload: LaborCostReport = {
    branches,
    targets: {
      laborCostTargetPercent: targets.laborCostTargetPercent,
      laborCostWarnPercent: targets.laborCostWarnPercent,
    },
    period,
  };

  return ApiHandler.success(payload);
});
