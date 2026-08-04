import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { maskSensitive } from "@/lib/rbac/masking";
import { ApiHandler } from "@/lib/api/response";
import { timbrarNomina } from "@/lib/services/fiscal-service";

const timbrarSchema = z.object({
  empleadoRfc: z.string().min(12, "RFC del empleado inválido.").max(13),
  empleadoNombre: z.string().min(1, "El nombre del empleado es requerido."),
  empleadoCurp: z.string().optional(),
  periodo: z.string().min(1, "El período de nómina es requerido (ej: 2025-01)."),
  totalPercepciones: z.number().int().positive("Las percepciones deben ser positivas."),
  totalDeducciones: z.number().int().min(0, "Las deducciones no pueden ser negativas."),
  uuid: z.string().optional(),
});

/**
 * POST /api/finance/fiscal/timbrar-nomina
 * Generates CFDI nómina digital stamp via FiscalAPI.
 *
 * Migrated to `requirePermissionApi('reports','manage', { classification:
 * 'FINANCIAL' })` (Sprint 2 Track B). Uses 'manage' (not 'read') because
 * timbrar is a mutating fiscal action that mints a CFDI. The redundant
 * `requireAuth()` call is dropped — `requirePermissionApi` authenticates via
 * `requireRoleApi` (throws 401 unauthenticated).
 */
export async function POST(req: NextRequest) {
  try {
    const { decision } = await requirePermissionApi("reports", "manage", {
      classification: "FINANCIAL",
      audit: { action: "APPROVE", req },
    });

    const body = await req.json();
    const data = timbrarSchema.parse(body);

    const result = await timbrarNomina(data);
    return ApiHandler.success(maskSensitive(result, decision));
  } catch (error) {
    return ApiHandler.error(error);
  }
}