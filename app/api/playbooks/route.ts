/**
 * GET /api/playbooks — playbooks corporativos del grupo con su cobertura por
 * sucursal.
 *
 * Guard: `workflows` read (el recurso en `lib/permissions.ts` es 'workflows',
 * en plural — 'workflow' no existe en la unión `Resource`).
 */
import { requirePermissionApi } from "@/lib/rbac/abac";
import { apiResponse, apiError } from "@/lib/api/response";
import { PlaybookService } from "@/lib/services/playbook-service";

export async function GET() {
  try {
    const { user } = await requirePermissionApi("workflows", "read");
    if (!user.companyId) return apiError("Company context required", 400);

    const playbooks = await PlaybookService.listPublished(user.companyId);
    return apiResponse({ playbooks });
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 500;
    return apiError(
      error instanceof Error ? error.message : "Failed to list playbooks",
      status,
    );
  }
}
