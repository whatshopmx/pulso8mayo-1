import { NextResponse } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import { apiResponse, apiError } from "@/lib/api/response";

/**
 * GET /api/executive/twin — latest persisted Executive Twin for the actor's
 * company (groupWide aggregate). Returns 404 when no twin has been computed
 * yet (the Inngest cron `recalculate-executive-twin` populates it every 15m;
 * POST /api/executive/twin/refresh forces one).
 *
 * Guarded by `requirePermissionApi('reports','read')` — the first /api/executive/*
 * route migrated to the ABAC guard (docs/pulso-executive-os-security.md §10).
 */
export async function GET() {
  try {
    const { user } = await requirePermissionApi("reports", "read");
    const companyId = user.companyId;
    if (!companyId) {
      return apiError("Company context required", 400);
    }

    const twin = await ExecutiveTwinEngine.getLatest(companyId);
    if (!twin) {
      return apiError("Executive twin not found", 404);
    }

    return apiResponse(twin, 200);
  } catch (error) {
    // requirePermissionApi throws ApiError(401/403) — surface its status.
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 500;
    const message =
      error instanceof Error ? error.message : "Failed to fetch executive twin";
    return apiError(message, status);
  }
}

// Reject non-GET verbs explicitly so the route is unambiguous.
export async function POST() {
  return NextResponse.json(
    { success: false, error: { message: "Use POST /api/executive/twin/refresh" } },
    { status: 405 },
  );
}