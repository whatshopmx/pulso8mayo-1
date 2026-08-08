/**
 * GET   /api/company/subscription — tier activo + features + catálogo de tiers.
 * POST  /api/company/subscription — cambia el tier (up/downgrade). Body { tierSlug }.
 * PATCH /api/company/subscription — cambia solo el estado. Body { status }.
 *
 * Guard: `billing` read para GET, `billing` manage para las mutaciones — ADMIN
 * tiene `billing: ['read']` y por tanto puede ver el plan pero no cambiarlo.
 */
import type { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { apiResponse, apiError } from "@/lib/api/response";
import { TierService, TIER_ORDER, type TierSlug } from "@/lib/services/tier-service";

const VALID_STATUSES = ["ACTIVE", "TRIAL", "PAST_DUE", "CANCELLED"];

function statusFromError(error: unknown): number {
  return error && typeof error === "object" && "statusCode" in error
    ? (error as { statusCode: number }).statusCode
    : 500;
}

export async function GET() {
  try {
    const { user } = await requirePermissionApi("billing", "read");
    if (!user.companyId) return apiError("Company context required", 400);

    const [tier, catalog] = await Promise.all([
      TierService.getCompanyTier(user.companyId),
      TierService.listTiers(),
    ]);

    return apiResponse({ tier, catalog });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Failed to load subscription",
      statusFromError(error),
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requirePermissionApi("billing", "manage");
    if (!user.companyId) return apiError("Company context required", 400);

    const body = await request.json().catch(() => null);
    const tierSlug = body?.tierSlug as string | undefined;

    if (!tierSlug || !(TIER_ORDER as string[]).includes(tierSlug)) {
      return apiError(
        `tierSlug inválido. Valores: ${TIER_ORDER.join(", ")}`,
        400,
      );
    }

    const tier = await TierService.setTier(user.companyId, tierSlug as TierSlug, {
      status: body?.status,
      expiresAt: body?.expiresAt ? new Date(body.expiresAt) : null,
      autoRenew: body?.autoRenew,
    });

    return apiResponse({ tier });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Failed to update subscription",
      statusFromError(error),
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requirePermissionApi("billing", "manage");
    if (!user.companyId) return apiError("Company context required", 400);

    const body = await request.json().catch(() => null);
    const status = body?.status as string | undefined;

    if (!status || !VALID_STATUSES.includes(status)) {
      return apiError(`status inválido. Valores: ${VALID_STATUSES.join(", ")}`, 400);
    }

    const tier = await TierService.setStatus(user.companyId, status);
    return apiResponse({ tier });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Failed to update status",
      statusFromError(error),
    );
  }
}
