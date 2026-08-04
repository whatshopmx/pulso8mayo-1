import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
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
 */
export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    await requireAuth();

    const body = await req.json();
    const data = timbrarSchema.parse(body);

    const result = await timbrarNomina(data);
    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
