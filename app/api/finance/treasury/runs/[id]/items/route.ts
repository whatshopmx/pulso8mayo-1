import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { TreasuryService } from "@/lib/services/treasury-service";
import { paymentRunItemTypeEnum } from "@/lib/db/schema";
import { z } from "zod";

const addItemSchema = z.object({
  itemType: z.enum(paymentRunItemTypeEnum.enumValues),
  referenceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
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

    const runDetails = await TreasuryService.getPaymentRunDetails(paymentRunId);

    if (runDetails.run.companyId !== ctx.userCompanyId) {
      return ApiHandler.error(ApiError.forbidden("No tienes acceso a esta corrida de pago."));
    }
    
    if (runDetails.run.status !== "DRAFT") {
      return ApiHandler.error(ApiError.badRequest("Solo puedes agregar ítems a una corrida en estado DRAFT."));
    }

    const body = await req.json();
    const parsed = addItemSchema.safeParse(body);
    if (!parsed.success) {
      return ApiHandler.error(ApiError.badRequest("Datos del ítem inválidos."));
    }

    const { itemType, referenceId, amountCents, notes } = parsed.data;

    const item = await TreasuryService.addItemToRun(
      paymentRunId,
      itemType,
      referenceId,
      amountCents,
      notes
    );

    return ApiHandler.success(item);
  } catch (error: any) {
    if (error.message === "Payment run not found") {
      return ApiHandler.error(ApiError.notFound("Corrida de pago no encontrada."));
    }
    if (error instanceof ApiError) return ApiHandler.error(error);
    return ApiHandler.error(error);
  }
}
