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

    const invoices = await TreasuryService.getUnpaidMatchedInvoices(ctx.userCompanyId);
    
    return ApiHandler.success(invoices);
  } catch (error: any) {
    if (error instanceof ApiError) return ApiHandler.error(error);
    return ApiHandler.error(error);
  }
}
