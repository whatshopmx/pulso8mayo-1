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

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");

    const payrollRuns = await TreasuryService.getUnpaidPayrollRuns(ctx.userCompanyId, branchId);
    
    return ApiHandler.success(payrollRuns);
  } catch (error: any) {
    if (error instanceof ApiError) return ApiHandler.error(error);
    return ApiHandler.error(error);
  }
}
