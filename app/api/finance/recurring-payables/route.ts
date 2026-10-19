import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import {
  cancelRecurringPayable,
  listRecurringPayables,
  runRecurringPayablesCycle,
} from "@/lib/services/recurring-payable-service";

/**
 * Payables recurrentes estimados — la obligación sin CFDI todavía.
 *
 * GET es Inventario (lista con estado); POST fuerza el ciclo generado+sync
 * manualmente (el cron diario ya lo hace; el botón existe para pruebas y para
 * que el cierre no espere a las 6:30), y PATCH cancela una estimación abierta
 * (contrato pausado, período no aplica) — siempre conservando la fila como
 * registro auditable del período.
 */

const cancelSchema = z.object({
  payableId: z.string().uuid("La estimación es inválida."),
});

export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    // El alcance no viene del query: sirven el panel del rol que consulta,
    // y lo aplicado lo declara el header del dashboard branch ctx.
    const items = await listRecurringPayables({
      companyId: ctx.userCompanyId,
    });

    const openCents = items
      .filter((i) => i.status === "OPEN")
      .reduce((acc, i) => acc + i.estimatedAmountCents, 0);

    return ApiHandler.success({
      items,
      total: items.length,
      openCents,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    // El ciclo completo es idempotente por diseño: correrlo a mano después
    // del cron no duplica filas, sólo adelanta a la ventana de hoy.
    const result = await runRecurringPayablesCycle({
      companyId: ctx.userCompanyId,
    });

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = cancelSchema.parse(await req.json());

    await cancelRecurringPayable({
      companyId: ctx.userCompanyId,
      payableId: body.payableId,
    });

    return ApiHandler.success({ ok: true });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
