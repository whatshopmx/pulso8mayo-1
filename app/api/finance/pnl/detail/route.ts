import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { maskSensitive } from "@/lib/rbac/masking";
import { resolveBranchScope } from "@/lib/branch-scope";
import { ApiError, isApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import { getPnlDetail, pnlDetailQuerySchema } from "@/lib/services/pnl-detail-service";

export async function GET(req: NextRequest) {
  try {
    const { ctx, decision } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL", audit: { action: "READ", req },
    });
    const query = pnlDetailQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const scope = resolveBranchScope(ctx.userRole, ctx.userBranchId, query.branchId);
    const detail = await getPnlDetail({ ...query, companyId: ctx.userCompanyId, scope });
    const response = ApiHandler.success(maskSensitive(detail, decision));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return ApiHandler.error(error instanceof ZodError || isApiError(error)
      ? error : ApiError.internal("No se pudo consultar el detalle del P&L."));
  }
}
