import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { getCommissionsByBranch } from "@/lib/services/commission-service";
import { resolvePnlPeriod } from "@/lib/services/pnl-service";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/finance/commissions?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=…
 *
 * Comisiones del período por sucursal y canal. El renglón vive en el P&L, pero
 * ahí es un solo importe: la pregunta que el dueño trae —"¿me conviene Rappi?"—
 * necesita el desglose por canal contra la venta de ese canal, y eso no cabe en
 * una celda.
 *
 * Se devuelven **todas** las sucursales del alcance, incluidas las que no
 * tuvieron ventas: una sucursal ausente de la lista se lee como "no cargó" y no
 * como "no vendió por canales con comisión".
 */
export const GET = withTenantAuth(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || searchParams.get("startDate") || undefined;
  const to = searchParams.get("to") || searchParams.get("endDate") || undefined;

  // Mismo criterio que /api/finance/pnl y /api/finance/labor-cost:
  // `resolveBranchScope` distingue "ve toda la empresa" de "está acotado y no
  // tiene sucursal", que `enforceBranchScope` colapsa en el mismo `null`.
  const alcance = resolveBranchScope(
    auth.user.role,
    auth.user.branchId,
    searchParams.get("branchId"),
  );

  if (alcance.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una para ver las comisiones.",
    );
  }

  const period = resolvePnlPeriod(from, to);

  const [branchList, todas] = await Promise.all([
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.companyId, auth.tenantId)),
    getCommissionsByBranch(auth.tenantId, period.startDate, period.endDate),
  ]);

  const byBranch = new Map(todas.map((c) => [c.branchId, c]));

  const visibles =
    alcance.kind === "BRANCH"
      ? branchList.filter((b) => b.id === alcance.branchId)
      : branchList;

  const items = visibles.map((b) => {
    const c = byBranch.get(b.id);
    return {
      branchId: b.id,
      branchName: b.name,
      channels: c?.channels ?? [],
      totalCommissionCents: c?.totalCommissionCents ?? 0,
      coveredSalesCents: c?.coveredSalesCents ?? 0,
      uncoveredSalesCents: c?.uncoveredSalesCents ?? 0,
      // Sin cortes en el período no hay nada que estimar y tampoco nada que
      // afirmar: `NO_DATA` es la lectura honesta, no un cero.
      source: c?.source ?? "NO_DATA",
      coveragePercent: c?.coveragePercent ?? 0,
      note: c?.note ?? "Sin cortes de venta capturados en el período.",
    };
  });

  return ApiHandler.success({ branches: items, period });
});
