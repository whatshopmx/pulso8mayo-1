import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { maskSensitive } from "@/lib/rbac/masking";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { getCashFlowProjection } from "@/lib/services/cash-flow-service";
import { resolveBranchScope } from "@/lib/branch-scope";

/**
 * GET /api/finance/cash-flow
 * Guarded by `requirePermissionApi('reports','read', { classification:
 * 'FINANCIAL' })` (Sprint 2 Track B). `ctx.userCompanyId` replaces the legacy
 * `requireTenant().id` — both read `user.companyId` from the same session, so
 * the scoped tenant id is identical. Non-gate roles (GERENTE/…) get an
 * allow+redact decision; this route returns aggregates with no PII fields, so
 * masking (Task 3) is a no-op here → plaintext-equivalent to the prior behavior.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx, decision } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const { searchParams } = new URL(req.url);
    const daysStr = searchParams.get("days");
    const days = daysStr ? parseInt(daysStr, 10) : 30;

    // La ruta recibía `branchId` desde la página y lo tiraba: una dueña que
    // cambiaba a "Polanco" veía las cifras del grupo entero etiquetadas como esa
    // sucursal, y actuaba sobre ellas. `enforceBranchScope` además fija a
    // GERENTE y SUPERVISOR a la suya aunque pidan otra.
    const alcance = resolveBranchScope(
      ctx.userRole,
      ctx.userBranchId,
      searchParams.get("branchId")
    );

    // Aquí NO devolvemos una proyección vacía, a diferencia de la lista de
    // gastos. Una proyección en ceros no se lee como "no hay datos": se
    // renderiza como "Saldo mínimo $0" y "Te alcanza para 0 días", que son
    // afirmaciones sobre el dinero de alguien y serían falsas. Con el usuario
    // mal configurado, la respuesta honesta es decirlo.
    if (alcance.kind === "NONE") {
      throw ApiError.forbidden(
        "Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una para ver el flujo de efectivo."
      );
    }

    const effectiveBranchId = alcance.kind === "BRANCH" ? alcance.branchId : null;

    const projection = await getCashFlowProjection(
      ctx.userCompanyId,
      days,
      effectiveBranchId ?? undefined
    );
    return ApiHandler.success(maskSensitive(projection, decision));
  } catch (error) {
    return ApiHandler.error(error);
  }
}