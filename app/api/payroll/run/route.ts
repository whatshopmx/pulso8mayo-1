import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { executePayrollRun } from "@/lib/services/payroll-service";

const runPayrollSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
});

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const body = await req.json();
    const data = runPayrollSchema.parse(body);

    const result = await executePayrollRun(
      tenant.id,
      data.startDate,
      data.endDate,
      user.id
    );

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
