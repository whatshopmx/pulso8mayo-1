import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { maskSensitive } from "@/lib/rbac/masking";
import { ApiHandler } from "@/lib/api/response";
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

    const pnl = await getPnLByBranch(ctx.userCompanyId, startDate, endDate);

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