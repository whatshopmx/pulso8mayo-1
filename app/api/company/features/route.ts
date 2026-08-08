/**
 * GET /api/company/features — features activas del tier de la compañía.
 *
 * Sin query params devuelve la lista completa con su estado (activa / tier que
 * la desbloquea). Con `?feature=<slug>` devuelve solo el gate de esa feature,
 * que es lo que consume un componente cliente antes de renderizar.
 *
 * Guard: `settings` read — cualquiera que ve la configuración puede saber qué
 * features tiene su grupo; no expone precios ni datos de facturación.
 */
import type { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { apiResponse, apiError } from "@/lib/api/response";
import {
  TierService,
  TIER_FEATURES,
  TIER_ORDER,
  TIER_LABELS,
} from "@/lib/services/tier-service";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requirePermissionApi("settings", "read");
    if (!user.companyId) return apiError("Company context required", 400);

    const feature = request.nextUrl.searchParams.get("feature");

    if (feature) {
      const gate = await TierService.getFeatureGate(user.companyId, feature);
      return apiResponse({ feature, ...gate });
    }

    const tier = await TierService.getCompanyTier(user.companyId);
    const active = new Set(tier.features as string[]);

    const all = TIER_ORDER.flatMap((slug) =>
      TIER_FEATURES[slug].map((f) => ({
        feature: f,
        tier: slug,
        tierLabel: TIER_LABELS[slug],
        active: active.has(f),
      })),
    );

    return apiResponse({
      tier: tier.slug,
      tierLabel: tier.label,
      features: all,
      activeCount: all.filter((f) => f.active).length,
    });
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 500;
    return apiError(
      error instanceof Error ? error.message : "Failed to load features",
      status,
    );
  }
}
