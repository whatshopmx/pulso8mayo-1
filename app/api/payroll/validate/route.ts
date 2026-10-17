// app/api/payroll/validate/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { validatePayrollPreStamping } from "@/lib/services/payroll-service";

const validatePayrollSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  branchId: z.string().uuid().optional(),
});

/**
 * POST /api/payroll/validate
 *
 * Pre-validación de la nómina antes de timbrar. Devuelve incidencias por
 * empleado (nombre, RFC, errores de salario), así que se gatea como lectura
 * FINANCIAL del módulo de nómina (S-1, Phase -1). Antes solo autenticaba.
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const body = await req.json();
    const data = validatePayrollSchema.parse(body);

    const validation = await validatePayrollPreStamping(
      ctx.userCompanyId,
      data.startDate,
      data.endDate,
      data.branchId
    );

    return ApiHandler.success(validation);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
