// app/api/finance/treasury/runs/[id]/layout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { TreasuryService } from "@/lib/services/treasury-service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: paymentRunId } = await params;
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "SPEI_CSV") as "SPEI_CSV" | "BANORTE_TXT" | "BBVA_TXT";

    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const layout = await TreasuryService.generateBankDisbursementLayout(
      paymentRunId,
      ctx.userCompanyId,
      format
    );

    return ApiHandler.success(layout);
  } catch (error: any) {
    if (error.message === "Corrida de pago no encontrada") {
      return ApiHandler.error(ApiError.notFound("Corrida de pago no encontrada."));
    }
    return ApiHandler.error(error);
  }
}
