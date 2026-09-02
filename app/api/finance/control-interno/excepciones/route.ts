import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { maskSensitiveList } from "@/lib/rbac/masking";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
import {
  VENTANA_EXCEPCIONES_DIAS,
  detectViolations,
} from "@/lib/services/control-interno-service";
import { CONTRACT_VARIANCE_WINDOW_DAYS } from "@/lib/services/recurring-contract-variance";

/**
 * GET /api/finance/control-interno/excepciones
 * Returns detected control violations sorted by severity.
 *
 * Migrated to `requirePermissionApi('reports','read', { classification:
 * 'FINANCIAL' })` (Sprint 2 Track B). Returns violation aggregates — no PII
 * fields, so the allow+redact path is plaintext-equivalent to the prior behavior.
 *
 * Query params:
 *   - branchId (optional) — se pasa como `targetBranchId` para que ABAC pueda
 *     403 a un rol acotado a sucursal que solicite una ajena.
 *   - sinceDays (optional) — ventana de detección. Por omisión 90 días (A5.1):
 *     antes el detector traía **todos** los gastos históricos de la empresa a
 *     memoria y los recorría en JavaScript, y a 15 sucursales con un año de
 *     operación son decenas de miles de filas en cada carga de la pantalla.
 *     La ventana viaja en la respuesta para que la UI pueda declararla: quien
 *     lee "sin excepciones" tiene derecho a saber sobre qué período se afirma.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;

    // Cota superior de un año: pedir "todo el histórico" por query devolvería
    // el problema que A5.1 cerró.
    const pedidos = Number(searchParams.get("sinceDays"));
    const sinceDays =
      Number.isFinite(pedidos) && pedidos > 0
        ? Math.min(Math.round(pedidos), 365)
        : VENTANA_EXCEPCIONES_DIAS;

    const { ctx, decision } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      targetBranchId: branchId,
      audit: { action: "READ", req },
    });

    // Ver `kpis`: omitir `branchId` dejaba la consulta sin filtro para un rol
    // acotado a sucursal.
    const alcance = resolveBranchScope(ctx.userRole, ctx.userBranchId, branchId);

    // Aquí sí se devuelve vacío, a diferencia de los agregados de dinero: una
    // lista de excepciones sin filas se lee correctamente como "ninguna", y es
    // la verdad para quien no alcanza ninguna sucursal.
    const violations =
      alcance.kind === "NONE"
        ? []
        : await detectViolations(
            ctx.userCompanyId,
            alcance.kind === "BRANCH" ? alcance.branchId : undefined,
            { sinceDays }
          );
    const payload = {
      violations: maskSensitiveList(violations, decision),
      total: violations.length,
      highSeverity: violations.filter((v) => v.severity === "HIGH").length,
      mediumSeverity: violations.filter((v) => v.severity === "MEDIUM").length,
      lowSeverity: violations.filter((v) => v.severity === "LOW").length,
      /**
       * Ventana que cubre la detección de desviaciones de contrato, en días.
       *
       * Va en la respuesta y no como constante del cliente porque es una
       * decisión del servicio: quien lee "sin excepciones" tiene que saber
       * sobre qué período se afirma. Antes no había ventana —la detección
       * miraba las últimas 5 facturas del proveedor, de cualquier fecha— y la
       * pantalla no podía declarar nada.
       */
      contractVarianceWindowDays: CONTRACT_VARIANCE_WINDOW_DAYS,
      /** Ventana de la detección de excepciones de gasto, en días (A5.1). */
      windowDays: sinceDays,
    };
    return ApiHandler.success(payload);
  } catch (error) {
    return ApiHandler.error(error);
  }
}