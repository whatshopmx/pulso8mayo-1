import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    branchBudgets,
    purchaseOrders,
    serviceOrders,
    tenantOperatingConfig,
} from "@/lib/db/schema";

/**
 * Servicio de presupuesto por sucursal × centro de costo × mes
 * (finzasordenes.md §2 validaciones + §7 desviación presupuestal).
 *
 * Convenciones:
 * - Montos en centavos (integer), igual que todo el repo.
 * - `month` con formato "YYYY-MM".
 * - "Comprometido" = OC/OS ya aprobadas o más adelante en su ciclo. Borradores
 *   y pendientes de aprobar NO comprometen presupuesto; rechazadas/canceladas
 *   tampoco.
 * - El tope de emergencias vive en `tenantOperatingConfig.emergencyPurchaseCapCents`
 *   (NULL = sin tope) y se edita desde la UI existente del operating-config.
 */

/** Estados que comprometen presupuesto, por tipo de documento. */
export const OS_COMMITTING_STATUSES = [
    "APPROVED",
    "SCHEDULED",
    "IN_PROGRESS",
    "PENDING_CONFORMITY",
    "CLOSED",
] as const;

export const OC_COMMITTING_STATUSES = [
    "APPROVED",
    "SENT",
    "PARTIALLY_RECEIVED",
    "CLOSED",
] as const;

// ── Funciones puras (cubiertas por budget-service.test.ts) ──

export interface BudgetStatus {
    budgeted: number;
    committed: number;
    available: number;
}

/** disponible = presupuestado − Σ comprometido. Sin presupuesto → 0 disponible. */
export function computeBudgetStatus(budgeted: number | null, commitments: number[]): BudgetStatus {
    const committed = commitments.reduce((sum, c) => sum + Math.max(0, c), 0);
    const budgetedSafe = Math.max(0, budgeted ?? 0);
    return {
        budgeted: budgetedSafe,
        committed,
        available: budgetedSafe - committed,
    };
}

export interface EmergencyCapDecision {
    /** false = bloquear el envío. */
    allowed: boolean;
    cap: number | null;
    usedBefore: number;
    usedAfter: number;
    overBy: number; // centavos excedidos (0 si cabe)
}

/**
 * Evalúa si una compra EMERGENCIA de `newAmount` cabe dentro del tope mensual.
 * cap null → sin tope, siempre permitido.
 */
export function evaluateEmergencyCap(
    cap: number | null,
    used: number,
    newAmount: number,
): EmergencyCapDecision {
    if (cap === null) {
        return { allowed: true, cap: null, usedBefore: used, usedAfter: used + newAmount, overBy: 0 };
    }
    const usedAfter = used + newAmount;
    return {
        allowed: usedAfter <= cap,
        cap,
        usedBefore: used,
        usedAfter,
        overBy: Math.max(0, usedAfter - cap),
    };
}

// ── Acceso a datos ──

const monthExpr = sql<string>`to_char(created_at, 'YYYY-MM')`;

/**
 * Presupuesto capturado para sucursal+centro+mes (o null si no hay fila).
 */
export async function getBudget(
    branchId: string,
    costCenterId: string,
    month: string,
): Promise<number | null> {
    const [row] = await db
        .select({ amount: branchBudgets.amount })
        .from(branchBudgets)
        .where(
            and(
                eq(branchBudgets.branchId, branchId),
                eq(branchBudgets.costCenterId, costCenterId),
                eq(branchBudgets.month, month),
            ),
        )
        .limit(1);
    return row?.amount ?? null;
}

/**
 * Comprometido del mes para sucursal+centro, sumando OS y OC en estados que
 * comprometen. Documentos sin centro de costo asignado no se atribuyen aquí.
 */
export async function getCommitted(
    branchId: string,
    costCenterId: string,
    month: string,
): Promise<number> {
    const osRows = await db
        .select({ total: serviceOrders.amount })
        .from(serviceOrders)
        .where(
            and(
                eq(serviceOrders.branchId, branchId),
                eq(serviceOrders.costCenterId, costCenterId),
                inArray(serviceOrders.status, [...OS_COMMITTING_STATUSES]),
                sql`${monthExpr} = ${month}`,
            ),
        );

    const ocRows = await db
        .select({ total: purchaseOrders.totalAmount })
        .from(purchaseOrders)
        .where(
            and(
                eq(purchaseOrders.branchId, branchId),
                eq(purchaseOrders.costCenterId, costCenterId),
                inArray(purchaseOrders.status, [...OC_COMMITTING_STATUSES]),
                sql`${monthExpr} = ${month}`,
            ),
        );

    return (
        osRows.reduce((s, r) => s + (r.total ?? 0), 0) +
        ocRows.reduce((s, r) => s + (r.total ?? 0), 0)
    );
}

export interface AvailabilityCheck extends BudgetStatus {
    ok: boolean;
    requested: number;
}

/** ¿Hay presupuesto disponible para este gasto? Sin partida presupuestada → no disponible. */
export async function checkBudgetAvailability(
    branchId: string,
    costCenterId: string,
    month: string,
    amountCents: number,
): Promise<AvailabilityCheck> {
    const [budgeted, committed] = await Promise.all([
        getBudget(branchId, costCenterId, month),
        getCommitted(branchId, costCenterId, month),
    ]);
    const status = computeBudgetStatus(budgeted, [committed]);
    return { ...status, requested: amountCents, ok: amountCents <= status.available };
}

/** 
 * Gastado en emergencias de la sucursal en el mes, en estados que comprometen:
 * OC con purchaseType=EMERGENCIA + OS con urgencia=EMERGENCIA. Se cuentan ambas
 * para que el tope no se burlre pagando la emergencia vía orden de servicio.
 */
export async function getEmergencyUsage(branchId: string, month: string): Promise<number> {
    const osRows = await db
        .select({ total: serviceOrders.amount })
        .from(serviceOrders)
        .where(
            and(
                eq(serviceOrders.branchId, branchId),
                eq(serviceOrders.urgency, "EMERGENCIA"),
                inArray(serviceOrders.status, [...OS_COMMITTING_STATUSES]),
                sql`${monthExpr} = ${month}`,
            ),
        );

    const ocRows = await db
        .select({ total: purchaseOrders.totalAmount })
        .from(purchaseOrders)
        .where(
            and(
                eq(purchaseOrders.branchId, branchId),
                eq(purchaseOrders.purchaseType, "EMERGENCIA"),
                inArray(purchaseOrders.status, [...OC_COMMITTING_STATUSES]),
                sql`${monthExpr} = ${month}`,
            ),
        );
    const ocTotal = ocRows.reduce((s, r) => s + (r.total ?? 0), 0);
    return osRows.reduce((s, r) => s + (r.total ?? 0), 0) + ocTotal;
}

async function getEmergencyCap(companyId: string): Promise<number | null> {
    const [row] = await db
        .select({ cap: tenantOperatingConfig.emergencyPurchaseCapCents })
        .from(tenantOperatingConfig)
        .where(eq(tenantOperatingConfig.companyId, companyId))
        .limit(1);
    return row?.cap ?? null;
}

export interface EmergencyCheckResult extends EmergencyCapDecision {
    usage: number[];
}

/**
 * Valida el tope mensual de emergencias al enviar a aprobación.
 * `pendingAmount` es el monto del documento que se está enviando (aún no cuenta).
 */
export async function validateEmergencyCap(
    companyId: string,
    branchId: string,
    month: string,
    pendingAmount: number,
): Promise<EmergencyCheckResult> {
    const [cap, used] = await Promise.all([
        getEmergencyCap(companyId),
        getEmergencyUsage(branchId, month),
    ]);
    const decision = evaluateEmergencyCap(cap, used, pendingAmount);
    return { ...decision, usage: [] };
}
