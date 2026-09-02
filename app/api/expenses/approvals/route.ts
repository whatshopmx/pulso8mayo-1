import { z } from "zod";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
import { approveOperatingExpense } from "@/lib/services/expense-service";

const approveSchema = z.object({
  expenseId: z.string().uuid("El ID de gasto es inválido."),
  notes: z.string().optional().nullable(),
});

export const POST = withTenantAuth(async (req, { auth }) => {
  const data = approveSchema.parse(await req.json());

  // El alcance sale de la sesión, nunca del cuerpo: un GERENTE fijado a una
  // sucursal resuelve la suya y nada más, y `NONE` (rol de sucursal sin
  // sucursal asignada) niega en vez de caer en el `null` que significa
  // "toda la empresa".
  const scope = resolveBranchScope(auth.user.role, auth.user.branchId);

  const updated = await approveOperatingExpense(
    data.expenseId,
    auth.tenantId,
    scope,
    auth.user.id,
    auth.user.role,
    data.notes || undefined
  );

  return ApiHandler.success(updated);
});
