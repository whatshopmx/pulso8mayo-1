import { apiResponse, apiError } from "@/lib/api/response";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import { inngest } from "@/lib/inngest/client";

/**
 * POST /api/executive/twin/refresh — force a synchronous recalculation of the
 * Executive Twin for the actor's company and return the updated row. Also
 * dispatches `executive/twin.updated` consumers may listen on (brief, feed).
 *
 * Guards: `requirePermissionApi('reports','manage')` — only roles that can
 * manage reports (OWNER/ADMIN/SUPER_ADMIN/GERENTE) may force a refresh.
 */
export async function POST() {
  try {
    const { user } = await requirePermissionApi("reports", "manage");
    const companyId = user.companyId;
    if (!companyId) {
      return apiError("Company context required", 400);
    }

    const twin = await ExecutiveTwinEngine.recalculate(companyId);
    if (!twin) {
      return apiError("No branches found for this company", 404);
    }

    // Best-effort fan-out to downstream consumers (brief generator, feed).
    // The engine already emitted executive/twin.updated; this is redundant but
    // harmless and keeps the refresh path decoupled from the engine internals.
    try {
      await inngest.send({
        name: "executive/twin.recalculate",
        data: { companyId },
      });
    } catch {
      /* Inngest offline in dev — non-fatal. */
    }

    return apiResponse(twin, 200);
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 500;
    const message =
      error instanceof Error ? error.message : "Failed to refresh executive twin";
    return apiError(message, status);
  }
}