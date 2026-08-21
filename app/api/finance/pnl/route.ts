import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { maskSensitive } from "@/lib/rbac/masking";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { getPnLByBranch } from "@/lib/services/pnl-service";

/**
 * GET /api/finance/pnl
 * Migrated to `requirePermissionApi('reports','read', { classification:
 * 'FINANCIAL' })` (Sprint 2 Track B). Returns consolidated P&L aggregates —
 * no PII fields, so the allow+redact path is plaintext-equivalent to the
 * prior `requireTenant` behavior.
 *
 * Cada renglón viaja con su `source` (`MEASURED` / `DERIVED` / `SECTOR_DEFAULT`
 * / `NO_DATA`) y su `note`. La respuesta incluye además un bloque `meta` con la
 * advertencia agregada, para que un consumidor que solo lea los totales — el
 * `FinanceEngine`, un export, un futuro endpoint de IA — no pueda perder de
 * vista que parte del P&L puede no estar calculada con datos del cliente
 * (docs/plan-pnl-real.md Fase 0, punto 3).
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx, decision } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    // Esta ruta ni siquiera leía `branchId`: devolvía siempre el renglón de cada
    // sucursal de la empresa, así que un GERENTE veía el P&L de la cadena
    // completa. `getPnLByBranch` agrega por empresa en cuatro consultas que no
    // escalan con el número de sucursales, así que el alcance se aplica sobre el
    // resultado en vez de multiplicar consultas.
    const alcance = resolveBranchScope(
      ctx.userRole,
      ctx.userBranchId,
      searchParams.get("branchId")
    );

    // Un P&L en ceros afirma un margen operativo, y sería falso. Sin sucursal
    // asignada la respuesta honesta es decirlo (mismo criterio que cash-flow).
    if (alcance.kind === "NONE") {
      throw ApiError.forbidden(
        "Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una para ver el P&L."
      );
    }

    const todas = await getPnLByBranch(ctx.userCompanyId, startDate, endDate);
    const pnl =
      alcance.kind === "BRANCH"
        ? todas.filter((b) => b.branchId === alcance.branchId)
        : todas;

    // `meta` se calcula sobre lo que de verdad se devuelve: describir el grupo
    // en la respuesta de una sola sucursal es la misma mentira, corrida un
    // renglón.
    const estimatedBranches = pnl.filter((b) => b.weakestLine !== "MEASURED");
    const meta = {
      branchCount: pnl.length,
      fullyMeasuredBranchCount: pnl.length - estimatedBranches.length,
      /** `true` si algún renglón de alguna sucursal NO se calculó con datos del cliente. */
      containsEstimates: estimatedBranches.length > 0,
      warning:
        estimatedBranches.length > 0
          ? "Al menos un renglón del P&L no se calcula con datos del cliente. " +
            "Revisa `source` por renglón: SECTOR_DEFAULT es una constante sectorial, " +
            "DERIVED es un cálculo indirecto y NO_DATA es un renglón faltante (no un cero). " +
            "No presentes el margen operativo como un número firme."
          : null,
    };

    return ApiHandler.success(maskSensitive({ branches: pnl, meta }, decision));
  } catch (error) {
    return ApiHandler.error(error);
  }
}