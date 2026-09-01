import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError, isApiError } from "@/lib/api/error";
import { TreasuryService } from "@/lib/services/treasury-service";
import { paymentRunItemTypeEnum } from "@/lib/db/schema";
import { z } from "zod";

/**
 * `amountCents` sigue siendo opcional y **solo lo usan los tipos sin documento**
 * (impuestos, reposición de caja chica). Para facturas y nómina el servicio lee
 * el monto del documento e ignora éste: un monto declarado por quien cobra no
 * puede ser el que sale del banco (G1.2).
 */
const addItemSchema = z.object({
  itemType: z.enum(paymentRunItemTypeEnum.enumValues),
  referenceId: z.string().uuid(),
  amountCents: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const paymentRunId = id;
    
    // Authorization
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = await req.json();
    const parsed = addItemSchema.safeParse(body);
    if (!parsed.success) {
      return ApiHandler.error(ApiError.badRequest("Datos del ítem inválidos."));
    }

    const { itemType, referenceId, amountCents, notes } = parsed.data;

    // La pertenencia al tenant y el estado DRAFT los afirma el servicio, con el
    // `companyId` de la sesión: la regla vive donde se escribe, no en la ruta.
    const item = await TreasuryService.addItemToRun({
      paymentRunId,
      companyId: ctx.userCompanyId,
      itemType,
      referenceId,
      amountCents,
      notes,
    });

    return ApiHandler.success(item);
  } catch (error: any) {
    // El status va explícito: `ApiHandler.error` mapea por `instanceof`, que
    // falla cuando Turbopack duplica el módulo de `ApiError` entre chunks.
    if (isApiError(error)) return ApiHandler.error(error, error.statusCode);
    return ApiHandler.error(error);
  }
}
