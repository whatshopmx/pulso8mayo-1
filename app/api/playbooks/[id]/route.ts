/**
 * GET  /api/playbooks/[id]      — estado por sucursal + historial de versiones.
 * POST /api/playbooks/[id]      — publica. Body { branchIds: string[] | null }.
 *                                 `null` o `[]` ⇒ todas las sucursales.
 * DELETE /api/playbooks/[id]    — revierte a plantilla local (scope='branch').
 *
 * `PlaybookService` valida la pertenencia del template y de cada sucursal a la
 * compañía del actor, así que el id de la URL nunca alcanza otra cuenta.
 */
import type { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { apiResponse, apiError } from "@/lib/api/response";
import { PlaybookService } from "@/lib/services/playbook-service";

function statusFromError(error: unknown): number {
  return error && typeof error === "object" && "statusCode" in error
    ? (error as { statusCode: number }).statusCode
    : 500;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requirePermissionApi("workflows", "read");
    if (!user.companyId) return apiError("Company context required", 400);

    const { id } = await params;
    const [scope, branchesState, versions] = await Promise.all([
      PlaybookService.getScope(id, user.companyId),
      PlaybookService.getPublicationState(id, user.companyId),
      PlaybookService.getVersions(id, user.companyId),
    ]);

    return apiResponse({ templateId: id, scope, branches: branchesState, versions });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Failed to load playbook",
      statusFromError(error),
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requirePermissionApi("workflows", "manage");
    if (!user.companyId) return apiError("Company context required", 400);

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const raw = body?.branchIds;

    if (raw != null && !Array.isArray(raw)) {
      return apiError("branchIds debe ser un array de ids o null", 400);
    }

    const result = await PlaybookService.publish(
      id,
      user.companyId,
      raw == null ? null : (raw as string[]),
      { userId: user.id, changeNote: body?.changeNote },
    );

    return apiResponse(result);
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Failed to publish playbook",
      statusFromError(error),
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requirePermissionApi("workflows", "manage");
    if (!user.companyId) return apiError("Company context required", 400);

    const { id } = await params;
    await PlaybookService.unpublish(id, user.companyId);
    return apiResponse({ templateId: id, scope: "branch" });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Failed to unpublish playbook",
      statusFromError(error),
    );
  }
}
