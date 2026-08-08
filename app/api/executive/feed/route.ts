/**
 * GET /api/executive/feed?limit=20 — decision feed: prioridades de todos los
 * engines ordenadas por impacto.
 *
 * Se construye sobre los snapshots ya cacheados en
 * `corporate_twins.executive_state.engineSnapshots`, así que no reejecuta
 * ningún engine.
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

    const raw = Number(request.nextUrl.searchParams.get("limit") ?? 20);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 20;

    const items = await MorningBriefService.getDecisionFeed(companyId, limit);
    return apiResponse({ items, count: items.length });
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 500;
    return apiError(
      error instanceof Error ? error.message : "Failed to fetch decision feed",
      status,
    );
  }
}
