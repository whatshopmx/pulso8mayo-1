import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
import { getAttentionSummary } from "@/lib/services/attention-service";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * GET /api/finance/attention
 *
 * Endpoint centralizador de la bandeja de acción "Hoy" de Finanzas.
 * Agrega en una sola respuesta:
 * - Excepciones de control interno detectadas.
 * - Gastos en espera de autorización (`PENDING_APPROVAL`).
 * - Arqueos de caja (faltantes/sobrantes de efectivo).
 * - Conciliaciones de terminales TPV (faltantes/sobrantes de depósitos de tarjeta).
 *
 * Evalúa sobre el universo completo de datos del período sin truncar a 100 registros.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;

    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      targetBranchId: branchId,
      audit: { action: "READ", req },
    });

    const alcance = resolveBranchScope(ctx.userRole, ctx.userBranchId, branchId);

    if (alcance.kind === "NONE") {
      return ApiHandler.success({
        items: [],
        counts: { total: 0, high: 0, medium: 0, low: 0, expense: 0, cutCash: 0, cutTpv: 0, violation: 0 },
        sourceStatuses: { violations: "available", expenses: "available", cuts: "available" },
        scope: { branchId: null, branchName: null, kind: "NONE" as const },
      });
    }

    const effectiveBranchId = alcance.kind === "BRANCH" ? alcance.branchId : null;

    let branchName: string | null = null;
    if (effectiveBranchId) {
      const [b] = await db
        .select({ name: branches.name })
        .from(branches)
        .where(and(eq(branches.id, effectiveBranchId), eq(branches.companyId, ctx.userCompanyId)))
        .limit(1);
      branchName = b?.name ?? null;
    }

    const summary = await getAttentionSummary(ctx.userCompanyId, effectiveBranchId);

    return ApiHandler.success({
      ...summary,
      scope: {
        branchId: effectiveBranchId,
        branchName,
        kind: alcance.kind,
      },
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
