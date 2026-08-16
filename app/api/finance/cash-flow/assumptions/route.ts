import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import { enforceBranchScope } from "@/lib/branch-scope";
import { saveCashFlowAssumption } from "@/lib/services/cash-flow-service";
import { localDateString } from "@/lib/workflows/today";

/**
 * PUT /api/finance/cash-flow/assumptions
 *
 * Captura el saldo en caja y bancos del que arranca la proyección de flujo.
 * No hay tabla bancaria ni libro mayor en el esquema, así que este dato no se
 * puede derivar: lo pone una persona, y esta es la superficie para hacerlo.
 *
 * Sólo roles que responden por el dinero. Un EMPLEADO no captura el saldo de la
 * empresa, y un READONLY no escribe nada.
 */
const bodySchema = z.object({
  /** En centavos. Puede ser negativo: una cuenta sobregirada es un saldo real. */
  openingBalanceCents: z
    .number({ message: "El saldo debe ser un número." })
    .int("El saldo debe venir en centavos enteros.")
    .min(-100_000_000_00, "El saldo está fuera de rango.")
    .max(100_000_000_00, "El saldo está fuera de rango."),
  /** `null` = supuesto del grupo completo. */
  branchId: z.string().uuid("La sucursal es inválida.").nullable().optional(),
  /** Fecha a la que corresponde el saldo. Por defecto, hoy. */
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe venir como YYYY-MM-DD.")
    .optional(),
});

export const PUT = withRoleAuth(
  ["SUPER_ADMIN", "ADMIN", "GERENTE"],
  async (req, { auth }) => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw ApiError.badRequest(
        parsed.error.issues[0]?.message ?? "Los datos del saldo son inválidos."
      );
    }

    const { openingBalanceCents, asOfDate } = parsed.data;

    // Misma regla que la lectura: un GERENTE captura el saldo de su sucursal,
    // no el de otra ni el del grupo. `enforceBranchScope` lo fija.
    const branchId = enforceBranchScope(
      auth.user.role,
      auth.branchId,
      parsed.data.branchId ?? null
    );

    const hoy = localDateString(new Date(), null);
    if (asOfDate && asOfDate > hoy) {
      throw ApiError.badRequest("La fecha del saldo no puede estar en el futuro.");
    }

    await saveCashFlowAssumption({
      companyId: auth.tenantId,
      branchId,
      openingBalanceCents,
      asOfDate: asOfDate ?? hoy,
      updatedBy: auth.user.id,
    });

    return ApiHandler.success({ branchId, openingBalanceCents, asOfDate: asOfDate ?? hoy });
  }
);
