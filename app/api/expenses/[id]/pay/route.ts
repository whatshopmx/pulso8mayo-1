import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import { markPaidOperatingExpense } from "@/lib/services/expense-service";

/**
 * POST /api/expenses/[id]/pay
 *
 * Marca un gasto aprobado como pagado.
 *
 * Registra **el estado del gasto, no el movimiento bancario**: Pulso no se
 * conecta al banco. Es la diferencia entre "ya lo pagué" —lo que la dueña
 * sabe— y "el banco lo confirmó", que nadie aquí puede afirmar.
 *
 * Vive en el dominio de gastos y no en el de cash-flow: el panel de flujo de
 * efectivo es un consumidor más de esta operación.
 */
const bodySchema = z.object({
  /** Fecha real del pago, si no fue hoy. */
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe venir como YYYY-MM-DD.")
    .optional(),
});

export const POST = withRoleAuth(
  ["SUPER_ADMIN", "ADMIN", "GERENTE"],
  async (req, { auth, params }) => {
    // Mismo cast que el resto de rutas dinámicas del repo (ver
    // `app/api/incidents/[id]/escalate/route.ts`): en Next 16 `params` es Promise.
    const { id } = await (params as unknown as Promise<{ id: string }>);
    if (!id) throw ApiError.badRequest("Falta el identificador del gasto.");

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw ApiError.badRequest(
        parsed.error.issues[0]?.message ?? "Los datos del pago son inválidos."
      );
    }

    try {
      const updated = await markPaidOperatingExpense(
        id,
        auth.tenantId,
        auth.user.name || auth.user.email || "un usuario",
        parsed.data.paidAt ? new Date(`${parsed.data.paidAt}T12:00:00Z`) : undefined
      );
      return ApiHandler.success(updated);
    } catch (error) {
      // El servicio lanza `Error` con mensaje en español listo para mostrar.
      throw ApiError.badRequest(
        error instanceof Error ? error.message : "No se pudo marcar el gasto como pagado."
      );
    }
  }
);
