/**
 * Bandeja unificada de aprobaciones de finanzas.
 *
 * Tres flujos de aprobación funcionaban cada uno con su propia bandeja (o sin
 * ella): OC/OS con la matriz de `approval-matrix-service`, gastos con su ciclo
 * `PENDING_APPROVAL` y corridas de pago con doble firma. Nadie que aprueba tenía
 * una sola pantalla que contestara "qué puedo resolver hoy". Este servicio
 * agrega los tres en una lista homogénea, aplicando en cada fuente las mismas
 * reglas de elegibilidad que su flujo original (rol exigido, alcance de
 * sucursal y segregación de funciones). Es solo lectura: la acción de aprobar
 * sigue viviendo —y validando— en la API de cada flujo.
 */

import { db } from "@/lib/db";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { operatingExpenses, paymentApprovals, paymentRuns, users } from "@/lib/db/schema";
import { roleIsAtLeast } from "@/lib/permissions";
import type { BranchScope } from "@/lib/branch-scope";
import { listApprovalInbox, type InboxItem } from "./approval-matrix-service";
import { resolverRolExigido } from "./expense-service";

export type ApprovalSource = "OC" | "OS" | "EXPENSE" | "PAYMENT_RUN";

export interface UnifiedApprovalItem {
    /** Llave única (`source:docId`) para keys de React y dedupe. */
    id: string;
    source: ApprovalSource;
    sourceLabel: string;
    docId: string;
    title: string;
    amountCents: number | null;
    /** Quien pidió el documento (nombre legible), cuando se puede resolver. */
    requesterName: string | null;
    requiredRole: string | null;
    createdAt: Date;
    branchId: string | null;
    branchName: string | null;
    /** Enlace de profundidad a la pantalla donde se resuelve. */
    actionHref: string;
}

export const SOURCE_LABEL: Record<ApprovalSource, string> = {
    OC: "Orden de compra",
    OS: "Orden de servicio",
    EXPENSE: "Gasto operativo",
    PAYMENT_RUN: "Corrida de pago",
};

const ACTION_HREF: Record<ApprovalSource, string> = {
    OC: "/dashboard/inventory/purchase-orders",
    OS: "/dashboard/equipment/compliance/service-orders",
    EXPENSE: "/dashboard/finance/expenses",
    PAYMENT_RUN: "/dashboard/finance/treasury/runs",
};

/** Mapa `runId → aprobación pendiente` para corridas con doble firma. */
export interface PendingRunSignature {
    paymentRef: string;
    approvedBy: string | null;
}

/** Reducir los items OC/OS de `listApprovalInbox` al shape unificado. */
export function mapInboxItem(item: InboxItem): UnifiedApprovalItem {
    const href =
        item.docType === "OS"
            ? `${ACTION_HREF.OS}/${item.docId}`
            : `${ACTION_HREF.OC}/${item.docId}`;
    return {
        id: `${item.docType}:${item.requestId}`,
        source: item.docType,
        sourceLabel: SOURCE_LABEL[item.docType],
        docId: item.docId,
        title: `${item.docTypeLabel} ${item.folio}`,
        amountCents: item.amountCents,
        requesterName: null,
        requiredRole: item.requiredRole,
        createdAt: item.requestedAt,
        branchId: item.branchId,
        branchName: item.branchName,
        actionHref: href,
    };
}

/** Fusionar y ordenar: más viejo primero (los vencidos gritan primero). */
export function mergeInbox(
    groups: UnifiedApprovalItem[][]
): UnifiedApprovalItem[] {
    const seen = new Set<string>();
    const merged: UnifiedApprovalItem[] = [];
    for (const group of groups) {
        for (const item of group) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            merged.push(item);
        }
    }
    return merged.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
}

/**
 * Bandeja agregada para un actor. Cada fuente aplica sus propias reglas;
 * lo que sale aquí ya es actionable por el actor salvo carrera perdida
 * (alguien más aprobó primero), caso que las APIs de acción resuelven.
 */
export async function listUnifiedApprovalInbox(params: {
    companyId: string;
    actorId: string;
    actorRole: string | null | undefined;
    scope: BranchScope;
}): Promise<UnifiedApprovalItem[]> {
    const [ocOsGroup, expensesGroup, runsGroup] = await Promise.all([
        listOcOsPending(params),
        listExpensesPending(params),
        listPaymentRunsPending(params),
    ]);
    return mergeInbox([ocOsGroup, expensesGroup, runsGroup]);
}

async function listOcOsPending(params: {
    companyId: string;
    actorId: string;
    actorRole: string | null | undefined;
    scope: BranchScope;
}): Promise<UnifiedApprovalItem[]> {
    const items = await listApprovalInbox({
        companyId: params.companyId,
        actorId: params.actorId,
        actorRole: params.actorRole,
        branchId: params.scope.kind === "BRANCH" ? params.scope.branchId : undefined,
    });
    return items.map(mapInboxItem);
}

/**
 * Gastos en PENDING_APPROVAL / PENDING_OVERBUDGET_APPROVAL dentro del alcance,
 * no registrados por el propio actor (segregación) y con rol suficiente.
 *
 * El rol exigido NO está almacenado: se recalcula con `resolverRolExigido`
 * (regla de `expense_authorization_rules` + piso por monto del tenant), el
 * mismo criterio que `approveOperatingExpense` aplicará al resolver. Se
 * deduplica por monto para no repetir la consulta de la regla.
 */
async function listExpensesPending(params: {
    companyId: string;
    actorId: string;
    actorRole: string | null | undefined;
    scope: BranchScope;
}): Promise<UnifiedApprovalItem[]> {
    const rows = await db
        .select({
            id: operatingExpenses.id,
            category: operatingExpenses.category,
            description: operatingExpenses.description,
            amountCents: operatingExpenses.amount,
            requestedByName: users.name,
            createdAt: operatingExpenses.createdAt,
            branchId: operatingExpenses.branchId,
        })
        .from(operatingExpenses)
        .leftJoin(users, eq(users.id, operatingExpenses.requestedBy))
        .where(
            and(
                eq(operatingExpenses.companyId, params.companyId),
                inArray(operatingExpenses.status, [
                    "PENDING_APPROVAL",
                    "PENDING_OVERBUDGET_APPROVAL",
                ]),
                // Segregación de funciones: quien registró no ve aquí su gasto.
                ne(operatingExpenses.requestedBy, params.actorId),
                ...(params.scope.kind === "BRANCH"
                    ? [eq(operatingExpenses.branchId, params.scope.branchId)]
                    : []),
            )
        )
        .orderBy(desc(operatingExpenses.createdAt));

    // Rol exigido por monto — mismo criterio que la API de aprobación, dedupe
    // por monto: dos gastos de idéntico importe consultan la regla una vez.
    const rolPorMonto = new Map<number, string>();
    await Promise.all(
        [...new Set(rows.map((r) => r.amountCents))].map(async (amount) => {
            const { rol } = await resolverRolExigido(params.companyId, amount);
            rolPorMonto.set(amount, rol);
        })
    );

    return rows
        .map<UnifiedApprovalItem | null>((r) => {
            const requiredRole = rolPorMonto.get(r.amountCents) ?? "GERENTE";
            if (!roleIsAtLeast(params.actorRole ?? "", requiredRole)) return null;
            return {
                id: `EXPENSE:${r.id}`,
                source: "EXPENSE",
                sourceLabel: SOURCE_LABEL.EXPENSE,
                docId: r.id,
                title: `${r.category} — ${r.description}`,
                amountCents: r.amountCents,
                requesterName: r.requestedByName,
                requiredRole,
                createdAt: r.createdAt,
                branchId: r.branchId,
                branchName: null,
                actionHref: `${ACTION_HREF.EXPENSE}?focus=${r.id}`,
            };
        })
        .filter((r): r is UnifiedApprovalItem => r !== null);
}

/**
 * Corridas en PENDING_APPROVAL que el actor puede firmar: no la preparó él
 * (segregación) y no le falta solo SU segunda firma — si ya registró la
 * primera, otra persona debe cerrarla y no se le muestra.
 */
async function listPaymentRunsPending(params: {
    companyId: string;
    actorId: string;
    scope: BranchScope;
}): Promise<UnifiedApprovalItem[]> {
    const rows = await db
        .select({
            id: paymentRuns.id,
            title: paymentRuns.title,
            totalAmountCents: paymentRuns.totalAmountCents,
            runDate: paymentRuns.runDate,
            createdAt: paymentRuns.createdAt,
            preparedBy: paymentRuns.preparedBy,
            preparedByName: users.name,
            branchId: paymentRuns.branchId,
        })
        .from(paymentRuns)
        .leftJoin(users, eq(users.id, paymentRuns.preparedBy))
        .where(
            and(
                eq(paymentRuns.companyId, params.companyId),
                eq(paymentRuns.status, "PENDING_APPROVAL"),
                ne(paymentRuns.preparedBy, params.actorId),
                ...(params.scope.kind === "BRANCH"
                    ? [eq(paymentRuns.branchId, params.scope.branchId)]
                    : []),
            )
        )
        .orderBy(desc(paymentRuns.createdAt));

    if (rows.length === 0) return [];

    // Dedupe de auto-firma: la primera firma pendiente con el actor como
    // firmante saca la corrida de su bandeja (falta el otro autorizado).
    const signatures: PendingRunSignature[] = await db
        .select({
            paymentRef: paymentApprovals.paymentRef,
            approvedBy: paymentApprovals.approvedBy,
        })
        .from(paymentApprovals)
        .where(
            and(
                eq(paymentApprovals.companyId, params.companyId),
                eq(paymentApprovals.status, "PENDING"),
                inArray(
                    paymentApprovals.paymentRef,
                    rows.map((r) => r.id)
                ),
            )
        );
    const signedByActor = new Set(
        signatures.filter((s) => s.approvedBy === params.actorId).map((s) => s.paymentRef)
    );

    return rows
        .filter((r) => !signedByActor.has(r.id))
        .map<UnifiedApprovalItem>((r) => ({
            id: `PAYMENT_RUN:${r.id}`,
            source: "PAYMENT_RUN",
            sourceLabel: SOURCE_LABEL.PAYMENT_RUN,
            docId: r.id,
            title: r.title,
            amountCents: r.totalAmountCents,
            requesterName: r.preparedByName,
            requiredRole: null,
            createdAt: r.createdAt,
            branchId: r.branchId,
            branchName: null,
            actionHref: `${ACTION_HREF.PAYMENT_RUN}/${r.id}`,
        }));
}
