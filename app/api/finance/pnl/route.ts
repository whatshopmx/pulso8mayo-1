import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { getPnLByBranch } from "@/lib/services/pnl-service";

/**
 * GET /api/finance/pnl
 * Migrated to `requirePermissionApi('reports','read', { classification:
 * 'FINANCIAL' })` (Sprint 2 Track B). Returns consolidated P&L aggregates —
 * no PII fields, so the allow+redact path is plaintext-equivalent to the
 * prior `requireTenant` behavior.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const pnl = await getPnLByBranch(ctx.userCompanyId, startDate, endDate);
    return ApiHandler.success(pnl);
  } catch (error) {
    return ApiHandler.error(error);
  }
}