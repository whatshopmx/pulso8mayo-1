import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    branches,
    costCenters,
    suppliers,
    serviceOrderEvidence,
    serviceOrderQuotes,
    serviceOrders,
    approvalRequests,
} from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { draftFolio, nextFolio, type IssuedFolio } from "@/lib/services/folio-generator";
import {
    createApprovalRequests,
    resolveApprovalChain,
} from "@/lib/services/approval-matrix-service";
import {
    checkBudgetAvailability,
    validateEmergencyCap,
} from "@/lib/services/budget-service";

/**
 * Servicio de Órdenes de Servicio (finzasordenes.md).
 *
 * El submit es la operación crítica y corre en UNA transacción:
 *   cadena de autorización → cotizaciones mínimas → presupuesto/tope emergencias
 *   → folio real (nextFolio) → approval_requests → status PENDING_APPROVAL.
 *
 * El folio real se emite SOLO aquí: los borradores usan `DRAFT-*` para que un
 * borrador cancelado no deje hueco en la serie (doc §6). El incremento del
 * contador ocurre dentro de la transacción; si el update condicional
 * `WHERE status = 'DRAFT'` no afecta filas (submit concurrente), se lanza
 * error y el rollback regresa también el consecutivo — sin saltos.
 */

export type ServiceOrderRow = typeof serviceOrders.$inferSelect;

// ── Listado ──

export interface ListOrdersParams {
    companyId: string;
    branchId?: string;
    status?: string;
    type?: string;
    limit?: number;
    offset?: number;
}

export async function listOrders(params: ListOrdersParams) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const offset = Math.max(params.offset ?? 0, 0);

    const conditions = [eq(serviceOrders.companyId, params.companyId)];
    if (params.branchId) conditions.push(eq(serviceOrders.branchId, params.branchId));
    if (params.status) conditions.push(eq(serviceOrders.status, params.status as ServiceOrderRow["status"]));
    if (params.type) conditions.push(eq(serviceOrders.type, params.type as ServiceOrderRow["type"]));

    const where = and(...conditions);

    const orders = await db
        .select({
            id: serviceOrders.id,
            folio: serviceOrders.folio,
            type: serviceOrders.type,
            urgency: serviceOrders.urgency,
            status: serviceOrders.status,
            amount: serviceOrders.amount,
            scheduledDate: serviceOrders.scheduledDate,
            scope: serviceOrders.scope,
            supplierId: serviceOrders.supplierId,
            costCenterId: serviceOrders.costCenterId,
            createdAt: serviceOrders.createdAt,
            updatedAt: serviceOrders.updatedAt,
            branchName: branches.name,
            branchCode: branches.code,
            supplierName: suppliers.name,
            costCenterCode: costCenters.code,
            costCenterName: costCenters.name,
        })
        .from(serviceOrders)
        .leftJoin(branches, eq(branches.id, serviceOrders.branchId))
        .leftJoin(suppliers, eq(suppliers.id, serviceOrders.supplierId))
        .leftJoin(costCenters, eq(costCenters.id, serviceOrders.costCenterId))
        .where(where)
        .orderBy(desc(serviceOrders.createdAt))
        .limit(limit)
        .offset(offset);

    const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(serviceOrders)
        .where(where);

    return { orders, total, limit, offset };
}

// ── Detalle ──

export async function getOrderDetail(companyId: string, id: string) {
    const [order] = await db
        .select()
        .from(serviceOrders)
        .where(and(eq(serviceOrders.id, id), eq(serviceOrders.companyId, companyId)))
        .limit(1);
    if (!order) return null;

    const [quotes, evidence, approvals] = await Promise.all([
        db
            .select()
            .from(serviceOrderQuotes)
            .where(eq(serviceOrderQuotes.serviceOrderId, id))
            .orderBy(asc(serviceOrderQuotes.createdAt)),
        db
            .select()
            .from(serviceOrderEvidence)
            .where(eq(serviceOrderEvidence.serviceOrderId, id))
            .orderBy(asc(serviceOrderEvidence.createdAt)),
        db
            .select()
            .from(approvalRequests)
            .where(and(eq(approvalRequests.docType, "OS"), eq(approvalRequests.docId, id)))
            .orderBy(asc(approvalRequests.level)),
    ]);

    return { order, quotes, evidence, approvals };
}

async function loadCompanyOrder(companyId: string, id: string): Promise<ServiceOrderRow> {
    const [order] = await db
        .select()
        .from(serviceOrders)
        .where(and(eq(serviceOrders.id, id), eq(serviceOrders.companyId, companyId)))
        .limit(1);
    if (!order) throw new ApiError("Orden de servicio no encontrada", 404);
    return order;
}

// ── Validación de pertenencia al tenant (FKs que el cliente manda) ──

async function assertBranchInCompany(branchId: string, companyId: string): Promise<void> {
    const [row] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
        .limit(1);
    if (!row) throw new ApiError("La sucursal indicada no pertenece a la empresa", 400);
}

async function assertSupplierInCompany(supplierId: string, companyId: string): Promise<void> {
    const [row] = await db
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)))
        .limit(1);
    if (!row) throw new ApiError("El proveedor indicado no pertenece a la empresa", 400);
}

async function assertCostCenterInCompany(costCenterId: string, companyId: string): Promise<void> {
    const [row] = await db
        .select({ id: costCenters.id })
        .from(costCenters)
        .where(and(eq(costCenters.id, costCenterId), eq(costCenters.companyId, companyId)))
        .limit(1);
    if (!row) throw new ApiError("El centro de costo indicado no pertenece a la empresa", 400);
}

/** Valida las FKs opcionales presentes en el payload contra la empresa del tenant. */
async function validateReferences(
    companyId: string,
    data: { branchId: string; supplierId?: string | null; costCenterId?: string | null },
): Promise<void> {
    await assertBranchInCompany(data.branchId, companyId);
    if (data.supplierId) await assertSupplierInCompany(data.supplierId, companyId);
    if (data.costCenterId) await assertCostCenterInCompany(data.costCenterId, companyId);
}

// ── Creación de borrador ──

export interface CreateServiceOrderInput {
    branchId: string;
    type: ServiceOrderRow["type"];
    urgency?: ServiceOrderRow["urgency"];
    equipmentId?: string | null;
    complianceServiceId?: string | null;
    scope?: string | null;
    justification?: string | null;
    technicalReport?: string | null;
    supplierId?: string | null;
    amount?: number | null;
    scheduledDate?: Date | null;
    costCenterId?: string | null;
}

export async function createDraft(
    input: CreateServiceOrderInput,
    companyId: string,
    userId: string,
): Promise<ServiceOrderRow> {
    await validateReferences(companyId, {
        branchId: input.branchId,
        supplierId: input.supplierId,
        costCenterId: input.costCenterId,
    });

    // Folio placeholder DRAFT-*: el folio real se emite en submit para no dejar
    // huecos en la serie cuando un borrador se cancela.
    const [row] = await db
        .insert(serviceOrders)
        .values({
            companyId,
            branchId: input.branchId,
            folio: draftFolio(),
            createdBy: userId,
            type: input.type,
            urgency: input.urgency ?? "NORMAL",
            status: "DRAFT",
            equipmentId: input.equipmentId ?? null,
            complianceServiceId: input.complianceServiceId ?? null,
            scope: input.scope ?? null,
            justification: input.justification ?? null,
            technicalReport: input.technicalReport ?? null,
            supplierId: input.supplierId ?? null,
            amount: input.amount ?? null,
            scheduledDate: input.scheduledDate ?? null,
            costCenterId: input.costCenterId ?? null,
        })
        .returning();
    return row;
}

// ── Edición (solo DRAFT) ──

export type UpdateServiceOrderPatch = Partial<Omit<CreateServiceOrderInput, "branchId">> & {
    branchId?: string;
};

export async function updateDraft(
    id: string,
    patch: UpdateServiceOrderPatch,
    companyId: string,
): Promise<ServiceOrderRow> {
    const order = await loadCompanyOrder(companyId, id);
    if (order.status !== "DRAFT") {
        throw new ApiError(
            "Solo se pueden editar órdenes en borrador. Una vez enviada usa el flujo de aprobación.",
            409,
        );
    }

    await validateReferences(companyId, {
        branchId: patch.branchId ?? order.branchId,
        supplierId: patch.supplierId !== undefined ? patch.supplierId : order.supplierId,
        costCenterId: patch.costCenterId !== undefined ? patch.costCenterId : order.costCenterId,
    });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const field of [
        "branchId",
        "type",
        "urgency",
        "equipmentId",
        "complianceServiceId",
        "scope",
        "justification",
        "technicalReport",
        "supplierId",
        "amount",
        "scheduledDate",
        "costCenterId",
    ] as const) {
        if (patch[field] !== undefined) updates[field] = patch[field];
    }

    const [updated] = await db
        .update(serviceOrders)
        .set(updates)
        .where(and(eq(serviceOrders.id, id), eq(serviceOrders.companyId, companyId)))
        .returning();
    return updated;
}

// ── Submit a aprobación ──

export interface SubmitResult {
    order: ServiceOrderRow;
    folio: IssuedFolio;
    chain: { sequence: number; requiredRole: string; minQuotes: number }[];
    approvalsCreated: number;
}

function monthOf(date: Date): string {
    return date.toISOString().slice(0, 7); // "YYYY-MM" — misma base que to_char(created_at,'YYYY-MM') en budget-service
}

/**
 * Envía una OS en borrador a aprobación. Validaciones previas (lecturas fuera
 * de la transacción) + mutaciones atómicas dentro de ella:
 * folio ↔ status ↔ approval_requests. Un submit concurrente pierde por el
 * `WHERE status='DRAFT'` condicional; su rollback devuelve también el folio.
 */
export async function submitOrder(companyId: string, orderId: string): Promise<SubmitResult> {
    const order = await loadCompanyOrder(companyId, orderId);
    if (order.status !== "DRAFT") {
        throw new ApiError("La orden ya fue enviada y no está en borrador", 409);
    }
    const amount = order.amount ?? 0;
    if (amount <= 0) {
        throw new ApiError(
            "La orden requiere un monto mayor a cero antes de enviarla a aprobación",
            400,
        );
    }

    // 1. Cadena de autorización según matriz (seed perezoso en primera llamada).
    const chain = await resolveApprovalChain(companyId, "OS", amount);
    if (chain.length === 0) {
        throw new ApiError(
            "El monto no está cubierto por la matriz de autorización. " +
                "Pide a un administrador que agregue una regla que cubra este rango.",
            400,
        );
    }

    // 2. Cotizaciones mínimas: el nivel más exigente de la cadena manda.
    const minQuotes = Math.max(...chain.map((r) => r.minQuotes));
    const [{ count: quotesCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(serviceOrderQuotes)
        .where(eq(serviceOrderQuotes.serviceOrderId, orderId));
    if (quotesCount < minQuotes) {
        throw new ApiError(
            `Se requieren al menos ${minQuotes} cotización(es) para este monto; la orden tiene ${quotesCount}.`,
            400,
            { required: minQuotes, current: quotesCount },
        );
    }

    // 3. Presupuesto — o tope de emergencias si la urgencia es EMERGENCIA.
    // El mes de atribución es el de created_at del documento: así lo cuenta
    // getCommitted() cuando el doc pase a comprometer presupuesto.
    const month = monthOf(order.createdAt);
    if (order.urgency === "EMERGENCIA") {
        const capCheck = await validateEmergencyCap(companyId, order.branchId, month, amount);
        if (!capCheck.allowed) {
            const overBy = capCheck.overBy ?? 0;
            throw new ApiError(
                `Tope mensual de compras de emergencia excedido por $${(overBy / 100).toFixed(2)}. ` +
                    `Tope: $${((capCheck.cap ?? 0) / 100).toFixed(2)}, usado antes: $${((capCheck.usedBefore ?? 0) / 100).toFixed(2)}.`,
                400,
                { cap: capCheck.cap, usedBefore: capCheck.usedBefore, overBy },
            );
        }
    } else {
        if (!order.costCenterId) {
            throw new ApiError(
                "Asigna un centro de costo a la orden: sin partida no hay contra qué validar presupuesto.",
                400,
            );
        }
        const budget = await checkBudgetAvailability(order.branchId, order.costCenterId, month, amount);
        if (!budget.ok) {
            throw new ApiError(
                `Presupuesto insuficiente: disponible $${(budget.available / 100).toFixed(2)} ` +
                    `de $${(budget.budgeted / 100).toFixed(2)} presupuestado; la orden requiere $${(amount / 100).toFixed(2)}.`,
                400,
                { budget },
            );
        }
    }

    // 4. Transacción atómica: folio + status + approvals.
    return db.transaction(async (tx) => {
        const issued = await nextFolio({
            companyId,
            branchId: order.branchId,
            docType: "OS",
            tx,
        });

        const updated = await tx
            .update(serviceOrders)
            .set({ folio: issued.folio, status: "PENDING_APPROVAL", updatedAt: new Date() })
            .where(
                and(
                    eq(serviceOrders.id, orderId),
                    eq(serviceOrders.companyId, companyId),
                    eq(serviceOrders.status, "DRAFT"),
                ),
            )
            .returning();
        if (updated.length === 0) {
            // Otro submit ganó la carrera: rollback devuelve también el folio emitido.
            throw new ApiError("La orden ya fue enviada por otro usuario", 409);
        }

        const approvalsCreated = await createApprovalRequests({
            companyId,
            docType: "OS",
            docId: orderId,
            chain,
            tx,
        });

        return {
            order: updated[0],
            folio: issued,
            chain: chain.map((r) => ({
                sequence: r.sequence,
                requiredRole: r.requiredRole,
                minQuotes: r.minQuotes,
            })),
            approvalsCreated,
        };
    });
}
