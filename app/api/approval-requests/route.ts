import { NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import {
    listApprovalInbox,
    type InboxItem,
} from "@/lib/services/approval-matrix-service";
import {
    checkBudgetAvailability,
    getEmergencyCapUsage,
    type AvailabilityCheck,
} from "@/lib/services/budget-service";

export interface InboxItemWithBudget extends InboxItem {
    budget: AvailabilityCheck | null;
    emergency: { cap: number | null; used: number } | null;
}

function monthOf(date: Date): string {
    return date.toISOString().slice(0, 7);
}

/**
 * GET /api/approval-requests — bandeja de aprobaciones OC/OS del usuario.
 *
 * Solo requests accionables: nivel mínimo pendiente de su documento, rol
 * suficiente y no creados por el propio actor (segregación de funciones).
 * ⚠️ NO usar app/api/approvals — esa ruta pertenece a turnos RH.
 */
export async function GET() {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "read")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        const items = await listApprovalInbox({
            companyId: tenant.id!,
            actorId: user.id,
            actorRole: user.role,
            branchId: tenant.branchId ?? undefined,
        });

        // Enriquecimiento de presupuesto por lotes: una consulta por combinación
        // única sucursal×centro×mes (cacheada) y una de cap por sucursal-mes.
        const budgetCache = new Map<string, AvailabilityCheck>();
        const emergencyCache = new Map<string, { cap: number | null; used: number }>();

        const enriched: InboxItemWithBudget[] = await Promise.all(
            items.map(async (item) => {
                const month = monthOf(item.docCreatedAt);
                let budget: AvailabilityCheck | null = null;
                let emergency: { cap: number | null; used: number } | null = null;

                if (item.isEmergency) {
                    const eKey = `${item.branchId}:${month}`;
                    const cached = emergencyCache.get(eKey);
                    emergency = cached ?? await getEmergencyCapUsage(tenant.id!, item.branchId, month);
                    if (!cached) emergencyCache.set(eKey, emergency);
                } else if (item.costCenterId) {
                    const bKey = `${item.branchId}:${item.costCenterId}:${month}`;
                    const cached = budgetCache.get(bKey);
                    budget = cached ?? await checkBudgetAvailability(
                        item.branchId,
                        item.costCenterId,
                        month,
                        0, // sin monto pendiente: solo estado actual presupuesto vs comprometido
                    );
                    if (!cached) budgetCache.set(bKey, budget);
                }

                return { ...item, budget, emergency };
            }),
        );

        return NextResponse.json({ items: enriched, total: enriched.length });
    } catch (error: unknown) {
        console.error("Failed to list approval requests", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 },
        );
    }
}
