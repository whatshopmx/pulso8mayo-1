import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
import { LiveCommandService } from "@/lib/services/live-command-service";

/**
 * GET /api/group/live-pulse?branchId=
 *
 * Feed en tiempo real para el Centro de Control de Red ("En Vivo"):
 * consolidado de aperturas a tiempo, cobertura de turnos RH, temperaturas NOM-251,
 * ventas del día y alertas de rush para las 3 a 15 sucursales.
 */
export const GET = withTenantAuth(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const requestedBranchId = searchParams.get("branchId");

  const scope = resolveBranchScope(auth.user.role, auth.user.branchId, requestedBranchId);

  if (scope.kind === "NONE") {
    return ApiHandler.success({
      businessDate: new Date().toISOString().slice(0, 10),
      totalBranches: 0,
      openBranchesCount: 0,
      openRatePercent: 0,
      staffActiveNow: 0,
      staffAttendanceRate: 0,
      salesTodayCents: 0,
      criticalAlertsCount: 0,
      branches: [],
      rushAlerts: [],
    });
  }

  const targetBranchId = scope.kind === "BRANCH" ? scope.branchId : undefined;

  const livePulse = await LiveCommandService.getLivePulse(auth.tenantId, targetBranchId);

  return ApiHandler.success(livePulse);
});
