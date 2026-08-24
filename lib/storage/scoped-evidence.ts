/**
 * Scoped evidence — acceso a evidencias R2 aislado por empresa y sucursal.
 *
 * Modelo:
 * - Las keys de R2 llevan jerarquía de tenancy:
 *     `companies/{companyId}/branches/{branchId}/waste/{wasteId}/{ts}.jpg`
 *   El companyId SIEMPRE sale del servidor (sesión o lookup en BD), jamás del cliente.
 * - En BD se persiste la KEY, no una URL pública: la URL firmada se deriva en el
 *   momento de la lectura y expira. Los valores históricos que sí son URL
 *   (`http(s)://...` — seed data, uploads previos al modelo privado) se sirven
 *   tal cual por compatibilidad.
 *
 * Guardia de lectura (dos dimensiones, igual que el resto del módulo de mermas):
 *  1. EMPRESA: el WHERE de toda query incluye `company_id = tenantId`.
 *  2. SUCURSAL: roles clavados a sucursal (GERENTE/SUPERVISOR) solo acceden a
 *     filas de su propia branch — `enforceBranchScope`.
 */
import { generatePresignedUrl } from "./r2-client";
import { ApiError } from "@/lib/api/error";
import { enforceBranchScope, type BranchScope } from "@/lib/branch-scope";

/** TTL por defecto de las URLs firmadas de evidencia: 10 minutos. */
export const EVIDENCE_URL_TTL_SECONDS = 600;

/**
 * true cuando el valor guardado en BD es una KEY de objeto R2 (modelo nuevo)
 * y no una URL navegable (modelo legacy / seed).
 */
export function isR2ObjectKey(value: string | null | undefined): value is string {
  if (!value) return false;
  return !/^https?:\/\//i.test(value) && !value.startsWith("local://");
}

/** Key canónica para la foto de evidencia de una merma. */
export function buildWasteEvidenceKey(
  companyId: string,
  branchId: string,
  wasteId: string
): string {
  const timestamp = Date.now();
  return `companies/${companyId}/branches/${branchId}/waste/${wasteId}/${timestamp}.jpg`;
}

/** Key canónica para la evidencia de un paso de workflow. */
export function buildWorkflowEvidenceKey(
  companyId: string,
  branchId: string,
  instanceId: string,
  stepId: string
): string {
  const timestamp = Date.now();
  return `companies/${companyId}/branches/${branchId}/workflows/${instanceId}/${timestamp}_${stepId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jpg`;
}

/**
 * Normaliza un valor de evidencia a URL consumible por el usuario:
 * - URL http(s) o local:// (legacy) → tal cual.
 * - Key de R2 (modelo privado) → GET presignado con TTL corto.
 * Devuelve null si no hay nada que mostrar.
 */
export async function resolveEvidenceUrl(
  value: string | null | undefined,
  expiresIn: number = EVIDENCE_URL_TTL_SECONDS
): Promise<string | null> {
  if (!value) return null;
  if (!isR2ObjectKey(value)) return value;
  try {
    return await generatePresignedUrl(value, expiresIn);
  } catch (error) {
    console.error("[scoped-evidence] Error presignando key:", error);
    return null;
  }
}

/**
 * Guardia de sucursal para una fila de evidencia ya scopeada por empresa.
 * `scope` es el resultado de `resolveBranchScope` para el usuario actual:
 * ALL → pasa; BRANCH → la fila debe ser de esa sucursal; NONE → prohibido.
 */
export function assertBranchAccess(
  rowBranchId: string | null,
  scope: BranchScope
): void {
  if (scope.kind === "NONE") {
    throw ApiError.forbidden("Sin acceso a evidencias de esta sucursal");
  }
  if (scope.kind === "BRANCH" && rowBranchId !== scope.branchId) {
    // 404, no 403: no filtrar existencia de registros fuera del alcance
    throw ApiError.notFound("Evidencia no encontrada");
  }
}

export { enforceBranchScope };
