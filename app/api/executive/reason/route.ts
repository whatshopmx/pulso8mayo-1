/**
 * POST /api/executive/reason — razonamiento ejecutivo sobre el Executive Twin.
 *
 * Es la superficie del copiloto (T14): recibe una pregunta del director y la
 * responde apoyándose en el twin ya calculado y en los snapshots de engines,
 * devolviendo las fuentes (`engineId` + score + confianza) para que la respuesta
 * sea auditable.
 *
 * Gate: la feature `ai_copilot` del tier decide si se razona con LLM o se
 * devuelve el resumen heurístico. NUNCA devuelve 403 por el tier — degrada, que
 * es lo que pide el plan; el 403 lo reserva el guard de permisos.
 *
 * GET expone el estado de la feature para que la UI pinte el CTA de upgrade sin
 * tener que mandar una pregunta primero.
 */
import type { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { apiResponse, apiError } from "@/lib/api/response";
import { IntelligenceService } from "@/lib/services/intelligence-service";
import { TierService } from "@/lib/services/tier-service";

const MAX_QUESTION_LENGTH = 500;

function statusOf(error: unknown): number {
  return error && typeof error === "object" && "statusCode" in error
    ? (error as { statusCode: number }).statusCode
    : 500;
}

export async function GET() {
  try {
    const { user } = await requirePermissionApi("reports", "read");
    const companyId = user.companyId;
    if (!companyId) return apiError("Company context required", 400);

    const gate = await TierService.getFeatureGate(companyId, "ai_copilot");
    return apiResponse({ gate });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Failed to resolve copilot gate",
      statusOf(error),
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requirePermissionApi("reports", "read");
    const companyId = user.companyId;
    if (!companyId) return apiError("Company context required", 400);

    const body = await request.json().catch(() => null);
    const question =
      body && typeof body.question === "string" ? body.question.trim() : "";

    if (!question) return apiError("La pregunta es obligatoria", 400);
    if (question.length > MAX_QUESTION_LENGTH) {
      return apiError(
        `La pregunta no puede exceder ${MAX_QUESTION_LENGTH} caracteres`,
        400,
      );
    }

    const result = await IntelligenceService.reasonAbout({ question, companyId });
    return apiResponse(result);
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Failed to reason about twin",
      statusOf(error),
    );
  }
}
