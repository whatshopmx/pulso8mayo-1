import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { GatewayReportService } from "@/lib/services/gateway-report-service";

const assignSchema = z.object({
    /**
     * Cuenta propia a la que aterrizó el neto, contra el catálogo ACTIVO de la
     * empresa. `null` desasigna — la fila vuelve a "Sin destino", siempre
     * visible: la conciliación es juicio de persona y se puede corregir, el
     * histórico de la fila se resuelve en updatedAt/auditoría de la API.
     */
    destinationBankAccountId: z.string().uuid().nullable(),
});

/**
 * PATCH /api/finance/reconciliation/transactions/[id] — asignación retroactiva
 * de cuenta destino para filas ya importadas (el import histórico no sabía a
 * dónde iba el dinero). La selección múltiple del UI llama este endpoint por
 * fila: misma validación atómica por transacción, sin media-verdad parcial —
 * si una fila falla, las demás ya quedaron asignadas y el error nombra cuál.
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { ctx } = await requirePermissionApi("reports", "update", {
            classification: "FINANCIAL",
            audit: { action: "UPDATE", req },
        });

        const { id } = await params;
        const body = assignSchema.parse(await req.json());

        await GatewayReportService.assignDestination({
            companyId: ctx.userCompanyId,
            transactionId: id,
            destinationBankAccountId: body.destinationBankAccountId,
        });

        return ApiHandler.success({ ok: true });
    } catch (error) {
        return ApiHandler.error(error);
    }
}
