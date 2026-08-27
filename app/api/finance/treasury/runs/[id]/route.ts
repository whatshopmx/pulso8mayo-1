import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { TreasuryService } from "@/lib/services/treasury-service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const paymentRunId = params.id;
    const details = await TreasuryService.getPaymentRunDetails(paymentRunId);

    // Ensure they only read runs for their own company
    if (details.run.companyId !== ctx.userCompanyId) {
      return ApiHandler.error(ApiError.forbidden("No tienes acceso a esta corrida de pago."));
    }

    return ApiHandler.success(details);
  } catch (error: any) {
    if (error.message === "Payment run not found") {
      return ApiHandler.error(ApiError.notFound("Corrida de pago no encontrada."));
    }
    if (error instanceof ApiError) return ApiHandler.error(error);
    return ApiHandler.error(error);
  }
}
