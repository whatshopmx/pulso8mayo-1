/**
 * GET /api/executive/brief/latest — último Morning Brief del grupo.
 *
 * Incluye `previous`: el brief del día anterior, para que la UI pueda mostrar
 * el "vs ayer" sin una segunda llamada.
 *
 * Guard: `requirePermissionApi('reports','read')`, igual que /api/executive/twin.
 */
import { requirePermissionApi } from "@/lib/rbac/abac";
import { apiResponse, apiError } from "@/lib/api/response";
import { MorningBriefService } from "@/lib/services/morning-brief-service";
import { TierService } from "@/lib/services/tier-service";

export async function GET() {
  try {
    const { user } = await requirePermissionApi("reports", "read");
    const companyId = user.companyId;
    if (!companyId) return apiError("Company context required", 400);

    const gate = await TierService.getFeatureGate(companyId, "morning_brief");
    if (!gate.allowed) {
      return apiError(gate.reason, 402, { requiredTier: gate.requiredTier });
    }

    const latest = await MorningBriefService.getLatest(companyId);
    if (!latest) return apiError("Morning brief not found", 404);

    // Día anterior calendario respecto del brief más reciente.
    const prevDate = new Date(`${latest.briefDate}T00:00:00Z`);
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const previous = await MorningBriefService.getByDate(
      companyId,
      prevDate.toISOString().slice(0, 10),
    );

    return apiResponse({ brief: latest, previous });
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 500;
    return apiError(
      error instanceof Error ? error.message : "Failed to fetch morning brief",
      status,
    );
  }
}
