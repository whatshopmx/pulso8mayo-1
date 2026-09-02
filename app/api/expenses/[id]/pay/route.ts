import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiError, isApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
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
  /**
   * Con qué se pagó (A4.1). Se captura **al pagar** y no al registrar el gasto
   * porque es cuando se sabe: un gasto se autoriza sin saber todavía si saldrá
   * por transferencia o de la caja. De aquí sale la excepción de deducibilidad
   * del artículo 27-III de la LISR.
   */
  paymentMethod: z
    .enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "DOMICILIADO", "CHEQUE"])
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

    // El alcance sale de la sesión, nunca del cuerpo —igual que en
    // `expenses/reject`. Un GERENTE fijado a una sucursal paga la suya y nada
    // más, y `NONE` (rol de sucursal sin sucursal asignada) niega en vez de
    // caer en el `null` que significa "toda la empresa".
    const scope = resolveBranchScope(auth.user.role, auth.user.branchId);

    try {
      const updated = await markPaidOperatingExpense(
        id,
        auth.tenantId,
        scope,
        // Quién paga sale de la sesión, nunca del cuerpo.
        auth.user.id,
        parsed.data.paymentMethod ?? null,
        parsed.data.paidAt ? new Date(`${parsed.data.paidAt}T12:00:00Z`) : undefined
      );
      return ApiHandler.success(updated);
    } catch (error) {
      // Un `ApiError` ya trae su propio estatus: aplastarlo a 400 convertiría
      // el 403 de alcance en "datos inválidos" y el 404 en lo mismo.
      if (isApiError(error)) throw error;
      throw ApiError.badRequest(
        error instanceof Error ? error.message : "No se pudo marcar el gasto como pagado."
      );
    }
  }
);
