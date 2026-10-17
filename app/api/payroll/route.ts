import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { getPayrollRuns } from "@/lib/services/payroll-service";

/**
 * GET /api/payroll
 *
 * Historial de corridas de nómina de la empresa. Lectura FINANCIAL del módulo
 * de nómina (S-1, Phase -1): antes solo autenticaba.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const runs = await getPayrollRuns(ctx.userCompanyId);
    return ApiHandler.success(runs);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
