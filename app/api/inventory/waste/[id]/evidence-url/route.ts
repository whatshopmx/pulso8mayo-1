import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { inventoryWaste } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import {
  assertBranchAccess,
  resolveEvidenceUrl,
} from "@/lib/storage/scoped-evidence";

/**
 * GET /api/inventory/waste/:id/evidence-url — URL firmada de la evidencia.
 *
 * Aislamiento por tenancy en dos capas (misma disciplina que el historial):
 * 1. EMPRESA: el SELECT filtra por `companyId = tenantId` (de la sesión, nunca
 *    del request) — una empresa jamás ve evidencias de otra.
 * 2. SUCURSAL: GERENTE/SUPERVISOR solo acceden a mermas de su propia branch
 *    (`resolveBranchScope` + `assertBranchAccess`); ADMIN/SUPER_ADMIN ven todas.
 *
 * Devuelve `{ url, mode }`:
 * - `mode: "signed"` → URL presignada de corta vida derivada de la KEY R2
 *   (modelo privado; la key nunca expone el bucket al público).
 * - `mode: "url"` → valor legacy ya navegable (seed data / uploads antiguos).
 */
export const GET = withTenantAuth(
  async (_req: NextRequest, { params, auth }: { params: Promise<{ id: string }>; auth: { tenantId: string; user: { role: string; branchId: string | null } } }) => {
    const { id } = await params;
    if (!id) throw ApiError.badRequest("Falta el id del registro");

    // Capa EMPRESA: el filtro va en el WHERE, no en código de aplicación.
    const [row] = await db
      .select({
        evidenceUrl: inventoryWaste.evidenceUrl,
        branchId: inventoryWaste.branchId,
      })
      .from(inventoryWaste)
      .where(
        and(eq(inventoryWaste.id, id), eq(inventoryWaste.companyId, auth.tenantId))
      )
      .limit(1);

    if (!row) {
      // Cubre tanto "no existe" como "pertenece a otra empresa": mismo 404,
      // sin filtrar existencia cross-tenant.
      throw ApiError.notFound("Merma no encontrada");
    }

    // Capa SUCURSAL: roles clavados a branch no ven mermas de otras sucursales.
    const scope = resolveBranchScope(
      auth.user.role as never,
      auth.user.branchId,
      undefined
    );
    assertBranchAccess(row.branchId, scope);

    if (!row.evidenceUrl) {
      throw ApiError.notFound("El registro no tiene evidencia fotográfica", {
        code: "NO_EVIDENCE",
      });
    }

    const url = await resolveEvidenceUrl(row.evidenceUrl);
    if (!url) {
      throw ApiError.notFound("La evidencia no está disponible", {
        code: "EVIDENCE_UNAVAILABLE",
      });
    }

    return ApiHandler.success({
      url,
      mode: /^https?:\/\//i.test(row.evidenceUrl) ? "url" : "signed",
    });
  }
);
