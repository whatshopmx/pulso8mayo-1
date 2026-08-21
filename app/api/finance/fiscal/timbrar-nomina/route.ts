import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { maskSensitive } from "@/lib/rbac/masking";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { getTimbrado, timbrarNomina } from "@/lib/services/fiscal-service";

const timbrarSchema = z.object({
  empleadoRfc: z.string().min(12, "RFC del empleado inválido.").max(13),
  empleadoNombre: z.string().min(1, "El nombre del empleado es requerido."),
  empleadoCurp: z.string().optional(),
  periodo: z.string().min(1, "El período de nómina es requerido (ej: 2025-01)."),
  totalPercepciones: z.number().int().positive("Las percepciones deben ser positivas."),
  totalDeducciones: z.number().int().min(0, "Las deducciones no pueden ser negativas."),
  // `uuid` ya no se acepta del cliente: un folio fiscal lo asigna el SAT a
  // través del PAC, no quien llama a la API. Aceptarlo permitía sembrar el
  // comprobante con un folio arbitrario (AD-A5).
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
    const { ctx, decision } = await requirePermissionApi("reports", "manage", {
      classification: "FINANCIAL",
      audit: { action: "APPROVE", req },
    });

    const body = await req.json();
    const data = timbrarSchema.parse(body);

    // `companyId` y `performedBy` salen de la sesión, como todo lo demás: el
    // comprobante se guarda a nombre de quien de verdad lo pidió.
    const result = await timbrarNomina({
      ...data,
      companyId: ctx.userCompanyId,
      performedBy: ctx.userId,
    });
    return ApiHandler.success(maskSensitive(result, decision));
  } catch (error) {
    return ApiHandler.error(error);
  }
}

/**
 * GET /api/finance/fiscal/timbrar-nomina?empleadoRfc=…&periodo=…
 *
 * Devuelve el timbrado guardado de ese período, o `null`. Existe para que la
 * pantalla pueda **recuperar el comprobante al recargar** —antes vivía sólo en
 * el estado de React— y para avisar de un período ya timbrado en vez de
 * ofrecer gastar otro folio.
 *
 * Es lectura: `read`, no `manage`. Timbrar sigue siendo el POST.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx, decision } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const { searchParams } = new URL(req.url);
    const empleadoRfc = searchParams.get("empleadoRfc")?.trim();
    const periodo = searchParams.get("periodo")?.trim();

    if (!empleadoRfc || !periodo) {
      throw ApiError.badRequest("Se requieren `empleadoRfc` y `periodo`.");
    }

    const timbrado = await getTimbrado(ctx.userCompanyId, empleadoRfc, periodo);

    // `null` es una respuesta válida: ese período no se ha timbrado.
    return ApiHandler.success(timbrado ? maskSensitive(timbrado, decision) : null);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
