import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { TreasuryService } from "@/lib/services/treasury-service";

/**
 * GET /api/finance/treasury/expenses/unpaid — espejo de
 * `treasury/invoices/unpaid`, para el tab de gastos operativos del modal de
 * la corrida de pago.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");

    const expenses = await TreasuryService.getUnpaidApprovedExpenses(ctx.userCompanyId, branchId);

    return ApiHandler.success(expenses);
  } catch (error: any) {
    if (error instanceof ApiError) return ApiHandler.error(error);
    return ApiHandler.error(error);
  }
}
