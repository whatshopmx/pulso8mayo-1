import { NextResponse } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ExecutiveDecisionService } from "@/lib/services/executive-decision-service";
import { apiResponse, apiError } from "@/lib/api/response";

/**
 * GET /api/executive/decisions — resoluciones vigentes de la Cola de
 * Decisiones de la compañía del actor (`executive_decisions`).
 *
 * POST /api/executive/decisions — persiste o revoca una resolución:
 *   { decisionKey: string, resolution: "authorized" | "deferred" }  → UPSERT
 *   { decisionKey: string, resolution: "revoke" }                   → DELETE
 *
 * Lectura con `reports:read` (GERENTE+); escritura con `reports:manage`
 * (sólo SUPER_ADMIN/OWNER/ADMIN autorizan en nombre de Dirección).
 */
export async function GET() {
  try {
    const { user } = await requirePermissionApi("reports", "read");
    const companyId = user.companyId;
    if (!companyId) {
      return apiError("Company context required", 400);
    }

    const decisions = await ExecutiveDecisionService.list(companyId);
    return apiResponse({ decisions }, 200);
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 500;
    const message =
      error instanceof Error ? error.message : "Failed to fetch executive decisions";
    return apiError(message, status);
  }
}

interface DecisionRequestBody {
  decisionKey?: unknown;
  resolution?: unknown;
}

export async function POST(request: Request) {
  try {
    const { session, user } = await requirePermissionApi("reports", "manage");
    const companyId = user.companyId;
    if (!companyId) {
      return apiError("Company context required", 400);
    }

    const body = (await request.json().catch(() => null)) as DecisionRequestBody | null;
    const decisionKey = typeof body?.decisionKey === "string" ? body.decisionKey.trim() : "";
    const resolution = typeof body?.resolution === "string" ? body.resolution : "";
    if (!decisionKey) {
      return apiError("decisionKey es obligatorio", 400);
    }

    if (resolution === "revoke") {
      await ExecutiveDecisionService.revoke({ companyId, decisionKey });
      return apiResponse({ decisionKey, resolution: null }, 200);
    }

    if (resolution !== "authorized" && resolution !== "deferred") {
      return apiError("resolution debe ser 'authorized', 'deferred' o 'revoke'", 400);
    }

    await ExecutiveDecisionService.resolve({
      companyId,
      decisionKey,
      resolution,
      userId: user.id,
      userName: session?.user?.name ?? null,
    });
    return apiResponse({ decisionKey, resolution, resolvedByName: session?.user?.name ?? null }, 200);
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 500;
    const message =
      error instanceof Error ? error.message : "Failed to persist executive decision";
    return apiError(message, status);
  }
}

// Reject non-listed verbs explicitly so the route is unambiguous.
export async function PUT() {
  return NextResponse.json(
    { success: false, error: { message: "Use POST /api/executive/decisions" } },
    { status: 405 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, error: { message: "Use POST con resolution:'revoke'" } },
    { status: 405 },
  );
}
