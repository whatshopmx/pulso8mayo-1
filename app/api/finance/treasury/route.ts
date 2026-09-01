import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { TreasuryService } from "@/lib/services/treasury-service";

export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const companyId = ctx.userCompanyId;

    const [paymentRuns, recurringContracts] = await Promise.all([
      TreasuryService.getPaymentRuns(companyId),
      TreasuryService.getRecurringContracts(companyId),
    ]);

    return ApiHandler.success({
      paymentRuns,
      recurringContracts,
    });
  } catch (error: any) {
    if (error instanceof ApiError) return ApiHandler.error(error);
    return ApiHandler.error(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "create", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const companyId = ctx.userCompanyId;
    const userId = ctx.userId;
    const body = await req.json();

    if (body.action === "CREATE_PAYMENT_RUN") {
      const { title, runDate, branchId } = body.payload;
      const run = await TreasuryService.createPaymentRun(
        companyId,
        title,
        new Date(runDate),
        userId,
        branchId || null
      );
      return ApiHandler.success({ run });
    }

    if (body.action === "CREATE_RECURRING_CONTRACT") {
      const {
        branchId,
        supplierId,
        title,
        contractType,
        baseAmountCents,
        startDate,
        paymentFrequency,
        varianceTolerancePercent,
        varianceToleranceBelowPercent,
      } = body.payload;

      // Las tolerancias viajan desde el formulario. Antes no existían en el
      // payload y la columna quedaba siempre en su 10% por omisión, así que un
      // recibo de CFE de temporada alta se reportaba como excepción de control
      // interno mes con mes sin que nadie pudiera ajustar el umbral.
      const contract = await TreasuryService.createRecurringContract({
        companyId,
        branchId: branchId || null,
        supplierId,
        title,
        contractType,
        baseAmountCents,
        startDate: new Date(startDate),
        userId,
        paymentFrequency: paymentFrequency || "MONTHLY",
        varianceTolerancePercent,
        varianceToleranceBelowPercent,
      });
      return ApiHandler.success({ contract });
    }

    return ApiHandler.error(ApiError.badRequest("Invalid action"));
  } catch (error: any) {
    if (error instanceof ApiError) return ApiHandler.error(error);
    return ApiHandler.error(error);
  }
}
