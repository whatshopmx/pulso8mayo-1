import { z } from "zod";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
import { rejectOperatingExpense } from "@/lib/services/expense-service";

const rejectSchema = z.object({
  expenseId: z.string().uuid("El ID de gasto es inválido."),
  // A diferencia de la aprobación, el motivo es obligatorio: sin él la bitácora
  // no explica por qué se negó el pago.
  reason: z.string().trim().min(1, "El motivo del rechazo es obligatorio."),
});

export const POST = withTenantAuth(async (req, { auth }) => {
  const data = rejectSchema.parse(await req.json());

  // El alcance sale de la sesión, nunca del cuerpo: un GERENTE fijado a una
  // sucursal resuelve la suya y nada más, y `NONE` (rol de sucursal sin
  // sucursal asignada) niega en vez de caer en el `null` que significa
  // "toda la empresa".
  const scope = resolveBranchScope(auth.user.role, auth.user.branchId);

  const updated = await rejectOperatingExpense(
    data.expenseId,
    auth.tenantId,
    scope,
    auth.user.id,
    auth.user.role,
    data.reason
  );

  return ApiHandler.success(updated);
});
