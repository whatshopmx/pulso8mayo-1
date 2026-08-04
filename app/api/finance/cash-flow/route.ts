import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { getCashFlowProjection } from "@/lib/services/cash-flow-service";

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
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
    });

    const { searchParams } = new URL(req.url);
    const daysStr = searchParams.get("days");
    const days = daysStr ? parseInt(daysStr, 10) : 30;

    const projection = await getCashFlowProjection(ctx.userCompanyId, days);
    return ApiHandler.success(projection);
  } catch (error) {
    return ApiHandler.error(error);
  }
}