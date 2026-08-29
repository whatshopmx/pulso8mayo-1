import { NextRequest } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { getPayrollPayslips } from "@/lib/services/payroll-service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    await requireAuth();

    const { id } = await params;
    if (!id) {
      throw ApiError.badRequest("ID de nómina requerido.");
    }

    const payslips = await getPayrollPayslips(id);
    return ApiHandler.success(payslips);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
