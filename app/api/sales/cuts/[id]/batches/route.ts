import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { TpvBatchService } from "@/lib/services/tpv-batch-service";

const batchItemSchema = z.object({
  terminalId: z.string().uuid("ID de terminal inválido"),
  batchNumber: z.string().min(1, "El folio de lote es requerido"),
  cardAmountCents: z
    .number()
    .int("El monto debe ser un entero en centavos")
    .min(0, "El monto en tarjeta debe ser mayor o igual a 0"),
  tipAmountCents: z
    .number()
    .int("La propina debe ser un entero en centavos")
    .min(0)
    .optional()
    .default(0),
  voucherPhotoUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const saveBatchesSchema = z.object({
  batches: z.array(batchItemSchema).min(1, "Debes proporcionar al menos un lote"),
});

/**
 * GET /api/sales/cuts/[id]/batches
 *
 * Obtiene los lotes físicos de terminales registrados para un corte de turno
 * y el estado de conciliación contra la venta con tarjeta reportada por el POS.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const result = await TpvBatchService.getBatchesForCut(
      ctx.userCompanyId,
      id
    );

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

/**
 * POST /api/sales/cuts/[id]/batches
 *
 * Guarda o actualiza los lotes físicos de terminales del corte.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = await req.json();
    const parsed = saveBatchesSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest(
        "Datos de lotes inválidos",
        parsed.error.issues
      );
    }

    const result = await TpvBatchService.saveBatches({
      companyId: ctx.userCompanyId,
      salesCutId: id,
      batches: parsed.data.batches,
      userId: ctx.userId,
    });

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
