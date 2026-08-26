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

    const companyId = ctx.session.companyId;

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
    return ApiHandler.internalError(error);
  }
}
