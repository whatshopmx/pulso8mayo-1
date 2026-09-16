import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { CrossBranchService } from "@/lib/services/cross-branch-service";

/**
 * GET /api/group/branches-qsr?period=30d
 *
 * Devuelve el ranking integral de la Liga de Sucursales para grupos QSR:
 * Prime Cost Combinado (Food Cost % + Labor Cost %), cumplimiento NOM-251,
 * conciliación de caja TPV, podio Top 3 y hallazgos narrativos de red (Executive Twin).
 */
export const GET = withTenantAuth(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const periodParam = searchParams.get("period") || "30d";

  const periodDays =
    periodParam === "7d"
      ? 7
      : periodParam === "90d"
      ? 90
      : periodParam === "ytd"
      ? 180
      : 30;

  const rankingResult = await CrossBranchService.getBranchQSRRanking(
    auth.tenantId,
    periodDays
  );

  return ApiHandler.success(rankingResult);
});
