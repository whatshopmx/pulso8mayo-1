import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { executePayrollRun } from "@/lib/services/payroll-service";

const runPayrollSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
});

/**
 * POST /api/payroll/run
 *
 * Ejecuta la corrida de nómina: calcula percepciones/deducciones por empleado
 * **y timbra el CFDI de nómina ante el PAC**. Es una operación fiscal
 * irreversible y con costo, así que exige autorización explícita.
 *
 * S-1 (Phase -1 / security gate): antes solo autenticaba (`requireTenant` +
 * `requireAuth`), de modo que cualquier usuario autenticado con `companyId`
 * podía ejecutar la nómina completa y consumir folios fiscales de la empresa.
 *
 * Guard: `requirePermissionApi("reports", "manage", { classification: "FINANCIAL" })`
 * — reutiliza el primitive ABAC existente. Solo ADMIN/OWNER/SUPER_ADMIN lo
 * alcanzan (GERENTE no tiene `reports:manage`); `tenantId` y `userId` salen de
 * la sesión (`ctx`), nunca del cuerpo; y la decisión (allow o deny) queda en
 * `data_access_logs`.
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "manage", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = await req.json();
    const data = runPayrollSchema.parse(body);

    const result = await executePayrollRun(
      ctx.userCompanyId,
      data.startDate,
      data.endDate,
      ctx.userId
    );

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
