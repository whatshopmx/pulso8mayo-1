/**
 * GET /api/executive/brief/history?limit=14 — briefs recientes del grupo.
 */
import type { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { apiResponse, apiError } from "@/lib/api/response";
import { MorningBriefService } from "@/lib/services/morning-brief-service";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requirePermissionApi("reports", "read");
    const companyId = user.companyId;
    if (!companyId) return apiError("Company context required", 400);

    const raw = Number(request.nextUrl.searchParams.get("limit") ?? 14);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 90) : 14;

    const briefs = await MorningBriefService.getHistory(companyId, limit);
    return apiResponse({ briefs, count: briefs.length });
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 500;
    return apiError(
      error instanceof Error ? error.message : "Failed to fetch brief history",
      status,
    );
  }
}
