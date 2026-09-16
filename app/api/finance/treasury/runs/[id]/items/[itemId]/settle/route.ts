import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError, isApiError } from "@/lib/api/error";
import { TreasuryService } from "@/lib/services/treasury-service";
import { z } from "zod";

const settleItemSchema = z.object({
  settlementStatus: z.enum(["CONFIRMED", "FAILED"]),
  reference: z.string().optional().nullable(),
  failureReason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * POST /api/finance/treasury/runs/[id]/items/[itemId]/settle
 * Registra la liquidación individual de una partida (CONFIRMED con comprobante o FAILED con motivo).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: paymentRunId, itemId } = await params;

    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = await req.json();
    const parsed = settleItemSchema.safeParse(body);
    if (!parsed.success) {
      return ApiHandler.error(ApiError.badRequest("Datos de liquidación inválidos."));
    }

    const { settlementStatus, reference, failureReason, notes } = parsed.data;

    const result = await TreasuryService.settlePaymentRunItem({
      paymentRunId,
      itemId,
      companyId: ctx.userCompanyId,
      settlementStatus,
      userId: ctx.userId,
      reference,
      failureReason,
      notes,
    });

    return ApiHandler.success(result);
  } catch (error: any) {
    if (isApiError(error)) return ApiHandler.error(error, error.statusCode);
    return ApiHandler.error(error);
  }
}
