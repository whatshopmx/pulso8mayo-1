import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    branchBudgets,
    costCenters,
    operatingExpenses,
    pettyCashFunds,
    pettyCashTransactions,
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
 * - Los **gastos operativos** también comprometen, y con otra regla: cuentan
 *   desde que se capturan (F3.2). Una OC pendiente de aprobar todavía se puede
 *   negar; un gasto ya ocurrió —la luz se consumió, el plomero vino— y el
 *   dinero ya salió aunque nadie haya firmado. Sólo los rechazados quedan
 *   fuera. Sin esto, el presupuesto significaría una cosa en órdenes y otra en
 *   gastos, que es justo lo que esta fase venía a cerrar.
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

/** Gastos que consumen presupuesto: todos menos el rechazado. */
export const EXPENSE_COMMITTING_STATUSES = [
    "PENDING_APPROVAL",
    "APPROVED",
    "PAID",
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
 * Comprometido del mes para sucursal+centro, sumando OS, OC y gastos operativos
 * en estados que comprometen. Documentos sin centro de costo asignado no se
 * atribuyen aquí.
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

    const gastoRows = await db
        .select({ total: operatingExpenses.amount })
        .from(operatingExpenses)
        .where(
            and(
                eq(operatingExpenses.branchId, branchId),
                eq(operatingExpenses.costCenterId, costCenterId),
                inArray(operatingExpenses.status, [...EXPENSE_COMMITTING_STATUSES]),
                sql`${monthExpr} = ${month}`,
            ),
        );

    // A4.2 — la caja chica consume la partida igual que un gasto: el efectivo
    // ya salió del centro de costo aunque no haya pasado por la autorización.
    const cajaChicaRows = await cajaChicaPorCentro([branchId], month);

    return (
        osRows.reduce((s, r) => s + (r.total ?? 0), 0) +
        ocRows.reduce((s, r) => s + (r.total ?? 0), 0) +
        gastoRows.reduce((s, r) => s + (r.total ?? 0), 0) +
        cajaChicaRows
            .filter((r) => r.costCenterId === costCenterId)
            .reduce((s, r) => s + (r.total ?? 0), 0)
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

/** Cap y uso actual de emergencias para mostrar en bandeja/presupuestos. */
export async function getEmergencyCapUsage(
    companyId: string,
    branchId: string,
    month: string,
): Promise<{ cap: number | null; used: number }> {
    const [cap, used] = await Promise.all([
        getEmergencyCap(companyId),
        getEmergencyUsage(branchId, month),
    ]);
    return { cap, used };
}

/**
 * Comprometido del mes agrupado por sucursal×centro en DOS queries (uno por tipo
 * de documento). Para bandejas y grids de presupuesto sin N+1.
 * Clave del mapa: `${branchId}:${costCenterId}`. Docs sin centro no se atribuyen.
 */
export async function getCommittedByPair(
    branchIds: string[],
    month: string,
): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    if (branchIds.length === 0) return totals;

    const accumulate = (
        rows: { branchId: string; costCenterId: string | null; total: number | null }[],
    ) => {
        for (const r of rows) {
            if (!r.costCenterId) continue;
            const key = `${r.branchId}:${r.costCenterId}`;
            totals.set(key, (totals.get(key) ?? 0) + (r.total ?? 0));
        }
    };

    const osRows = await db
        .select({
            branchId: serviceOrders.branchId,
            costCenterId: serviceOrders.costCenterId,
            total: sql<number>`coalesce(sum(${serviceOrders.amount}), 0)::int`,
        })
        .from(serviceOrders)
        .where(
            and(
                inArray(serviceOrders.branchId, branchIds),
                inArray(serviceOrders.status, [...OS_COMMITTING_STATUSES]),
                sql`${monthExpr} = ${month}`,
            ),
        )
        .groupBy(serviceOrders.branchId, serviceOrders.costCenterId);
    accumulate(osRows);

    const ocRows = await db
        .select({
            branchId: purchaseOrders.branchId,
            costCenterId: purchaseOrders.costCenterId,
            total: sql<number>`coalesce(sum(${purchaseOrders.totalAmount}), 0)::int`,
        })
        .from(purchaseOrders)
        .where(
            and(
                inArray(purchaseOrders.branchId, branchIds),
                inArray(purchaseOrders.status, [...OC_COMMITTING_STATUSES]),
                sql`${monthExpr} = ${month}`,
            ),
        )
        .groupBy(purchaseOrders.branchId, purchaseOrders.costCenterId);
    accumulate(ocRows);

    const gastoRows = await db
        .select({
            branchId: operatingExpenses.branchId,
            costCenterId: operatingExpenses.costCenterId,
            total: sql<number>`coalesce(sum(${operatingExpenses.amount}), 0)::int`,
        })
        .from(operatingExpenses)
        .where(
            and(
                inArray(operatingExpenses.branchId, branchIds),
                inArray(operatingExpenses.status, [...EXPENSE_COMMITTING_STATUSES]),
                sql`${monthExpr} = ${month}`,
            ),
        )
        .groupBy(operatingExpenses.branchId, operatingExpenses.costCenterId);
    accumulate(gastoRows);

    return totals;
}

// ── Consumo del mes por centro de costo (F3.3) ──

export interface CostCenterConsumption {
    costCenterId: string;
    code: string;
    name: string;
    /** `null` = no hay partida capturada para ese mes; NO es un presupuesto de 0. */
    budgetedCents: number | null;
    consumedCents: number;
    /** `null` cuando no hay presupuesto: sin denominador no hay porcentaje. */
    percent: number | null;
}

export interface BudgetConsumptionReport {
    month: string;
    rows: CostCenterConsumption[];
    /**
     * Gasto del mes que nadie clasificó. Si este renglón crece, la cobertura del
     * presupuesto se vuelve ficción: el resto de la tabla puede verse en verde
     * mientras el dinero sale por un lado que no mira ninguna barra.
     */
    unclassified: { amountCents: number; percentOfTotal: number };
    /** Gasto operativo total del mes en el alcance, clasificado o no. */
    totalExpensesCents: number;
}

/**
 * Presupuesto, consumido y % del mes por centro de costo, para el alcance de
 * sucursales que reciba.
 *
 * "Consumido" es lo mismo que evalúa `checkBudgetAvailability` —gastos, OC y
 * OS—, no sólo los gastos: una barra que ignorara las órdenes mostraría verde
 * un presupuesto ya comprometido, y contradiría al aviso que sí las cuenta.
 *
 * Se listan las partidas con presupuesto capturado **o** con consumo. El
 * catálogo QSR estándar trae ~30 centros; pintarlos todos en cero convertiría
 * el tablero en una lista que nadie recorre.
 */
/**
 * Salidas de caja chica del mes que consumen presupuesto (A4.2).
 *
 * Consumen igual que un gasto operativo: es dinero que ya salió del centro de
 * costo, y no contarlo dejaba la partida viéndose disponible cuando ya no lo
 * estaba. La diferencia es que **no pasa por la cola de autorización** —para
 * eso existe el fondo— así que se agrega desde su propia tabla en vez de
 * duplicarse como fila en `operating_expenses`.
 *
 * Sólo `OUT`: la reposición es el efectivo que entra al fondo y contarla
 * cobraría dos veces la misma compra.
 */
async function cajaChicaPorCentro(
    branchIds: string[],
    month: string,
): Promise<Array<{ branchId: string; costCenterId: string | null; total: number }>> {
    if (branchIds.length === 0) return [];
    return db
        .select({
            branchId: pettyCashFunds.branchId,
            costCenterId: pettyCashTransactions.costCenterId,
            total: sql<number>`coalesce(sum(${pettyCashTransactions.amount}), 0)::int`,
        })
        .from(pettyCashTransactions)
        .innerJoin(pettyCashFunds, eq(pettyCashTransactions.fundId, pettyCashFunds.id))
        .where(
            and(
                inArray(pettyCashFunds.branchId, branchIds),
                eq(pettyCashTransactions.type, "OUT"),
                sql`to_char(${pettyCashTransactions.createdAt}, 'YYYY-MM') = ${month}`,
            ),
        )
        .groupBy(pettyCashFunds.branchId, pettyCashTransactions.costCenterId);
}

export async function getBudgetConsumption(
    companyId: string,
    branchIds: string[],
    month: string,
): Promise<BudgetConsumptionReport> {
    const vacio: BudgetConsumptionReport = {
        month,
        rows: [],
        unclassified: { amountCents: 0, percentOfTotal: 0 },
        totalExpensesCents: 0,
    };
    if (branchIds.length === 0) return vacio;

    const [centros, budgetRows, committedByPair, gastoRows, cajaChicaRows] = await Promise.all([
        db
            .select({ id: costCenters.id, code: costCenters.code, name: costCenters.name })
            .from(costCenters)
            .where(and(eq(costCenters.companyId, companyId), eq(costCenters.active, true))),
        db
            .select({ costCenterId: branchBudgets.costCenterId, amount: branchBudgets.amount })
            .from(branchBudgets)
            .where(and(inArray(branchBudgets.branchId, branchIds), eq(branchBudgets.month, month))),
        getCommittedByPair(branchIds, month),
        db
            .select({
                costCenterId: operatingExpenses.costCenterId,
                total: sql<number>`coalesce(sum(${operatingExpenses.amount}), 0)::int`,
            })
            .from(operatingExpenses)
            .where(
                and(
                    inArray(operatingExpenses.branchId, branchIds),
                    inArray(operatingExpenses.status, [...EXPENSE_COMMITTING_STATUSES]),
                    sql`${monthExpr} = ${month}`,
                ),
            )
            .groupBy(operatingExpenses.costCenterId),
        cajaChicaPorCentro(branchIds, month),
    ]);

    // Presupuesto del alcance: la suma de las sucursales que se están mirando.
    const presupuestoPorCentro = new Map<string, number>();
    for (const r of budgetRows) {
        presupuestoPorCentro.set(r.costCenterId, (presupuestoPorCentro.get(r.costCenterId) ?? 0) + r.amount);
    }

    // `getCommittedByPair` viene por `sucursal:centro`; aquí se colapsa a centro.
    const consumidoPorCentro = new Map<string, number>();
    for (const [key, total] of committedByPair) {
        const costCenterId = key.split(":")[1];
        consumidoPorCentro.set(costCenterId, (consumidoPorCentro.get(costCenterId) ?? 0) + total);
    }

    // A4.2 — la caja chica se suma al consumo del centro de costo. Sin esto la
    // partida se veía disponible cuando el efectivo ya había salido.
    for (const r of cajaChicaRows) {
        if (!r.costCenterId) continue;
        consumidoPorCentro.set(
            r.costCenterId,
            (consumidoPorCentro.get(r.costCenterId) ?? 0) + (r.total ?? 0),
        );
    }

    const cajaChicaTotal = cajaChicaRows.reduce((s, r) => s + (r.total ?? 0), 0);
    const cajaChicaSinCentro = cajaChicaRows
        .filter((r) => !r.costCenterId)
        .reduce((s, r) => s + (r.total ?? 0), 0);

    const totalExpensesCents =
        gastoRows.reduce((s, r) => s + (r.total ?? 0), 0) + cajaChicaTotal;
    const sinClasificar =
        (gastoRows.find((r) => r.costCenterId === null)?.total ?? 0) + cajaChicaSinCentro;

    const rows = centros
        .map((cc) => {
            const budgetedCents = presupuestoPorCentro.has(cc.id)
                ? (presupuestoPorCentro.get(cc.id) as number)
                : null;
            const consumedCents = consumidoPorCentro.get(cc.id) ?? 0;
            return {
                costCenterId: cc.id,
                code: cc.code,
                name: cc.name,
                budgetedCents,
                consumedCents,
                percent:
                    budgetedCents && budgetedCents > 0
                        ? Math.round((consumedCents / budgetedCents) * 1000) / 10
                        : null,
            };
        })
        .filter((r) => r.budgetedCents !== null || r.consumedCents > 0)
        .sort((a, b) => a.code.localeCompare(b.code));

    return {
        month,
        rows,
        unclassified: {
            amountCents: sinClasificar,
            percentOfTotal:
                totalExpensesCents > 0
                    ? Math.round((sinClasificar / totalExpensesCents) * 1000) / 10
                    : 0,
        },
        totalExpensesCents,
    };
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
