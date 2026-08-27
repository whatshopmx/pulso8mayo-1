import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { TreasuryService } from "@/lib/services/treasury-service";
import { paymentRunStatusEnum } from "@/lib/db/schema";
import { z } from "zod";

const updateStatusSchema = z.object({
  status: z.enum(paymentRunStatusEnum.enumValues),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const paymentRunId = id;
    
    // First, let's verify if the run belongs to their company
    const runDetails = await TreasuryService.getPaymentRunDetails(paymentRunId);

    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    if (runDetails.run.companyId !== ctx.userCompanyId) {
      return ApiHandler.error(ApiError.forbidden("No tienes acceso a esta corrida de pago."));
    }

    const body = await req.json();
    const parsed = updateStatusSchema.safeParse(body);
    if (!parsed.success) {
      return ApiHandler.error(ApiError.badRequest("Estado inválido."));
    }

    const { status } = parsed.data;

    // Special authorization rules
    if (status === "APPROVED" || status === "PROCESSING" || status === "COMPLETED") {
      // For real financial approval, require ADMIN or higher
      if (ctx.userRole !== "ADMIN" && ctx.userRole !== "OWNER" && ctx.userRole !== "SUPER_ADMIN") {
        return ApiHandler.error(ApiError.forbidden("No tienes permisos suficientes para aprobar o procesar pagos."));
      }
    }

    const updatedRun = await TreasuryService.updatePaymentRunStatus(
      paymentRunId,
      status,
      ctx.userId
    );

    return ApiHandler.success(updatedRun);
  } catch (error: any) {
    if (error.message === "Payment run not found") {
      return ApiHandler.error(ApiError.notFound("Corrida de pago no encontrada."));
    }
    if (error instanceof ApiError) return ApiHandler.error(error);
    return ApiHandler.error(error);
  }
}
