import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { rejectOperatingExpense } from "@/lib/services/expense-service";

const rejectSchema = z.object({
  expenseId: z.string().uuid("El ID de gasto es inválido."),
  // A diferencia de la aprobación, el motivo es obligatorio: sin él la bitácora
  // no explica por qué se negó el pago.
  reason: z.string().trim().min(1, "El motivo del rechazo es obligatorio."),
});

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const body = await req.json();
    const data = rejectSchema.parse(body);

    // El alcance sale de la sesión, nunca del cuerpo: un GERENTE fijado a una
    // sucursal resuelve la suya y nada más, y `NONE` (rol de sucursal sin
    // sucursal asignada) niega en vez de caer en el `null` que significa
    // "toda la empresa".
    const scope = resolveBranchScope(user.role || "EMPLEADO", user.branchId);

    const updated = await rejectOperatingExpense(
      data.expenseId,
      tenant.id,
      scope,
      user.id,
      user.role || "EMPLEADO",
      data.reason
    );

    return ApiHandler.success(updated);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
