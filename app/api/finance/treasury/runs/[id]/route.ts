import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { isApiError } from "@/lib/api/error";
import { TreasuryService } from "@/lib/services/treasury-service";

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

    const paymentRunId = id;
    // C18 — la búsqueda lleva la empresa de la sesión. Antes el detalle se
    // armaba entero (partidas, facturas, nómina, gastos) y la ruta comparaba la
    // empresa después, respondiendo 403: la respuesta ajena ya se había
    // construido y el código confirmaba que el id existía.
    const details = await TreasuryService.getPaymentRunDetails(paymentRunId, ctx.userCompanyId);

    return ApiHandler.success(details);
  } catch (error: any) {
    if (isApiError(error)) return ApiHandler.error(error, error.statusCode);
    return ApiHandler.error(error);
  }
}
