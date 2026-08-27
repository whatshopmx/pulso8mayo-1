// app/api/payroll/validate/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { validatePayrollPreStamping } from "@/lib/services/payroll-service";

const validatePayrollSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  branchId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    await requireAuth();

    const body = await req.json();
    const data = validatePayrollSchema.parse(body);

    const validation = await validatePayrollPreStamping(
      tenant.id,
      data.startDate,
      data.endDate,
      data.branchId
    );

    return ApiHandler.success(validation);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
