import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { getPayrollPayslips } from "@/lib/services/payroll-service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });
    if (!ctx.userCompanyId) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw ApiError.badRequest("ID de nómina inválido.");
    }

    const payslips = await getPayrollPayslips(ctx.userCompanyId, id);
    return ApiHandler.success(payslips);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
