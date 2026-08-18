import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import { rescheduleOperatingExpense } from "@/lib/services/expense-service";
import { localDateString } from "@/lib/workflows/today";

/**
 * POST /api/expenses/[id]/reschedule
 *
 * Mueve la fecha de vencimiento de un gasto.
 *
 * Reprogramar es una decisión real de tesorería —se negoció con el proveedor, o
 * simplemente no alcanza— y la proyección la refleja de inmediato. Lo que no se
 * puede es mover al pasado: eso no reprograma nada, sólo maquilla un vencido
 * para que deje de aparecer como tal.
 */
const bodySchema = z.object({
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe venir como YYYY-MM-DD."),
});

export const POST = withRoleAuth(
  ["SUPER_ADMIN", "ADMIN", "GERENTE"],
  async (req, { auth, params }) => {
    const { id } = await (params as unknown as Promise<{ id: string }>);
    if (!id) throw ApiError.badRequest("Falta el identificador del gasto.");

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw ApiError.badRequest(
        parsed.error.issues[0]?.message ?? "La fecha es inválida."
      );
    }

    try {
      const updated = await rescheduleOperatingExpense(
        id,
        auth.tenantId,
        auth.user.name || auth.user.email || "un usuario",
        parsed.data.dueDate,
        localDateString(new Date(), null)
      );
      return ApiHandler.success(updated);
    } catch (error) {
      throw ApiError.badRequest(
        error instanceof Error ? error.message : "No se pudo reprogramar el gasto."
      );
    }
  }
);
