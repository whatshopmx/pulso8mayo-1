import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    branches,
    branchComplianceServices,
    costCenters,
    suppliers,
    serviceProviders,
    complianceServiceHistory,
    serviceOrderEvidence,
    serviceOrderQuotes,
    serviceOrders,
    approvalRequests,
    invoices,
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
import { roleIsAtLeast } from "@/lib/permissions";

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
    complianceServiceId?: string;
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
    // Origen normativo (R2): OS generadas desde un Servicio Normativo.
    if (params.complianceServiceId) conditions.push(eq(serviceOrders.complianceServiceId, params.complianceServiceId));

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
            serviceProviderId: serviceOrders.serviceProviderId,
            costCenterId: serviceOrders.costCenterId,
            createdAt: serviceOrders.createdAt,
            updatedAt: serviceOrders.updatedAt,
            branchName: branches.name,
            branchCode: branches.code,
            supplierName: suppliers.name,
            serviceProviderName: serviceProviders.name,
            costCenterCode: costCenters.code,
            costCenterName: costCenters.name,
        })
        .from(serviceOrders)
        .leftJoin(branches, eq(branches.id, serviceOrders.branchId))
        .leftJoin(suppliers, eq(suppliers.id, serviceOrders.supplierId))
        .leftJoin(serviceProviders, eq(serviceProviders.id, serviceOrders.serviceProviderId))
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
    const [row] = await db
        .select({
            order: serviceOrders,
            branchName: branches.name,
            branchCode: branches.code,
            costCenterCode: costCenters.code,
            costCenterName: costCenters.name,
            supplierName: suppliers.name,
            serviceProviderName: serviceProviders.name,
            serviceProviderPhone: serviceProviders.phone,
            serviceProviderEmail: serviceProviders.email,
        })
        .from(serviceOrders)
        .leftJoin(branches, eq(branches.id, serviceOrders.branchId))
        .leftJoin(costCenters, eq(costCenters.id, serviceOrders.costCenterId))
        .leftJoin(suppliers, eq(suppliers.id, serviceOrders.supplierId))
        .leftJoin(serviceProviders, eq(serviceProviders.id, serviceOrders.serviceProviderId))
        .where(and(eq(serviceOrders.id, id), eq(serviceOrders.companyId, companyId)))
        .limit(1);
    if (!row) return null;
    const order = {
        ...row.order,
        branchName: row.branchName,
        branchCode: row.branchCode,
        costCenterCode: row.costCenterCode,
        costCenterName: row.costCenterName,
        supplierName: row.supplierName,
        serviceProviderName: row.serviceProviderName,
        serviceProviderPhone: row.serviceProviderPhone,
        serviceProviderEmail: row.serviceProviderEmail,
    };

    const [quotes, evidence, approvals, linkedInvoice] = await Promise.all([
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
        // Factura ligada (control OC/OS, espejo del enlace de una OC). Nullable:
        // la mayoría de las OS abiertas todavía no tienen CFDI que asociar.
        db
            .select({
                id: invoices.id,
                folio: invoices.folio,
                serie: invoices.serie,
                uuid: invoices.uuid,
                total: invoices.total,
                fecha: invoices.fecha,
                paymentStatus: invoices.paymentStatus,
            })
            .from(invoices)
            .where(eq(invoices.serviceOrderId, id))
            .limit(1),
    ]);

    return { order, quotes, evidence, approvals, invoice: linkedInvoice[0] ?? null };
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

async function assertComplianceServiceInCompany(complianceServiceId: string, companyId: string): Promise<void> {
    const [row] = await db
        .select({ id: branchComplianceServices.id })
        .from(branchComplianceServices)
        .where(and(eq(branchComplianceServices.id, complianceServiceId), eq(branchComplianceServices.companyId, companyId)))
        .limit(1);
    if (!row) throw new ApiError("El servicio normativo indicado no pertenece a la empresa", 400);
}

async function assertServiceProviderInCompany(serviceProviderId: string, companyId: string): Promise<void> {
    const [row] = await db
        .select({ id: serviceProviders.id })
        .from(serviceProviders)
        .where(and(eq(serviceProviders.id, serviceProviderId), eq(serviceProviders.companyId, companyId)))
        .limit(1);
    if (!row) throw new ApiError("El proveedor de servicio indicado no pertenece a la empresa", 400);
}

/** Valida las FKs opcionales presentes en el payload contra la empresa del tenant. */
async function validateReferences(
    companyId: string,
    data: {
        branchId: string;
        supplierId?: string | null;
        serviceProviderId?: string | null;
        costCenterId?: string | null;
        complianceServiceId?: string | null;
    },
): Promise<void> {
    await assertBranchInCompany(data.branchId, companyId);
    if (data.supplierId) await assertSupplierInCompany(data.supplierId, companyId);
    if (data.serviceProviderId) await assertServiceProviderInCompany(data.serviceProviderId, companyId);
    if (data.costCenterId) await assertCostCenterInCompany(data.costCenterId, companyId);
    if (data.complianceServiceId) await assertComplianceServiceInCompany(data.complianceServiceId, companyId);
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
    serviceProviderId?: string | null;
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
        serviceProviderId: input.serviceProviderId,
        costCenterId: input.costCenterId,
        complianceServiceId: input.complianceServiceId,
    });

    let effectiveServiceProviderId = input.serviceProviderId ?? null;
    if (!effectiveServiceProviderId && input.complianceServiceId) {
        const [compService] = await db
            .select({ providerId: branchComplianceServices.providerId })
            .from(branchComplianceServices)
            .where(and(eq(branchComplianceServices.id, input.complianceServiceId), eq(branchComplianceServices.companyId, companyId)))
            .limit(1);
        if (compService?.providerId) {
            effectiveServiceProviderId = compService.providerId;
        }
    }

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
            serviceProviderId: effectiveServiceProviderId,
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
        serviceProviderId: patch.serviceProviderId !== undefined ? patch.serviceProviderId : order.serviceProviderId,
        costCenterId: patch.costCenterId !== undefined ? patch.costCenterId : order.costCenterId,
        complianceServiceId: patch.complianceServiceId !== undefined ? patch.complianceServiceId : order.complianceServiceId,
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
        "serviceProviderId",
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

// ── Guardias de estado y rol (puras, cubiertas por service-order-workflow.test.ts) ──

export type ServiceOrderAction = "schedule" | "start" | "complete" | "cancel";

/** Estados desde los que una orden puede cancelarse manualmente. */
const CANCELLABLE_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED"]);
/** Estados terminales: sin más evidencias ni cambios. */
const TERMINAL_STATUSES = new Set(["CLOSED", "REJECTED", "CANCELLED"]);

/**
 * Transiciones manuales del ciclo operativo post-aprobación:
 *   APPROVED → schedule → SCHEDULED → start → IN_PROGRESS → complete → PENDING_CONFORMITY
 * La salida a CLOSED no va por aquí sino por la firma de conformidad.
 */
export function actionTransitionError(current: string, action: ServiceOrderAction): string | null {
    switch (action) {
        case "cancel":
            return CANCELLABLE_STATUSES.has(current)
                ? null
                : `No se puede cancelar una orden en estado ${current}`;
        case "schedule":
            return current === "APPROVED"
                ? null
                : `Solo una orden aprobada puede programarse (estado actual: ${current})`;
        case "start":
            return current === "SCHEDULED"
                ? null
                : `Solo una orden programada puede iniciarse (estado actual: ${current})`;
        case "complete":
            return current === "IN_PROGRESS"
                ? null
                : `Solo una orden en ejecución puede marcarse como completada (estado actual: ${current})`;
    }
}

export function quoteGuardError(current: string): string | null {
    return current === "DRAFT"
        ? null
        : "Las cotizaciones solo se pueden adjuntar mientras la orden está en borrador";
}

export function evidenceGuardError(current: string): string | null {
    return TERMINAL_STATUSES.has(current)
        ? `No se puede subir evidencia de una orden en estado ${current}`
        : null;
}

export type ConformityDenial =
    | { kind: "ROLE"; message: string }
    | { kind: "STATUS"; message: string }
    | null;

/** La conformidad la firma GERENTE+ y solo con el servicio ya ejecutado. */
export function conformityDenial(
    actorRole: string | null | undefined,
    current: string,
): ConformityDenial {
    if (!actorRole || !roleIsAtLeast(actorRole, "GERENTE")) {
        return { kind: "ROLE", message: "Solo un GERENTE o rol superior puede firmar la conformidad" };
    }
    if (current !== "PENDING_CONFORMITY") {
        return {
            kind: "STATUS",
            message: `La conformidad se firma únicamente en estado PENDING_CONFORMITY (estado actual: ${current})`,
        };
    }
    return null;
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

// ── Ciclo operativo post-aprobación (Task 5b) ──

export async function transitionOrder(
    companyId: string,
    orderId: string,
    action: ServiceOrderAction,
    opts?: { scheduledDate?: Date | null },
): Promise<ServiceOrderRow> {
    const order = await loadCompanyOrder(companyId, orderId);
    const guard = actionTransitionError(order.status, action);
    if (guard) throw new ApiError(guard, 409);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    switch (action) {
        case "schedule":
            updates.status = "SCHEDULED";
            if (opts?.scheduledDate !== undefined) updates.scheduledDate = opts.scheduledDate;
            break;
        case "start":
            updates.status = "IN_PROGRESS";
            break;
        case "complete":
            updates.status = "PENDING_CONFORMITY";
            break;
        case "cancel":
            updates.status = "CANCELLED";
            break;
    }

    const [updated] = await db
        .update(serviceOrders)
        .set(updates)
        .where(and(eq(serviceOrders.id, orderId), eq(serviceOrders.companyId, companyId)))
        .returning();
    return updated;
}

/**
 * Enlace manual de respaldo: cuando el auto-match al capturar el CFDI no
 * aplicó (candidato ambiguo, o la OS usa `serviceProviderId` en vez de
 * `supplierId`, que el matcher automático no cubre), alguien lo captura a
 * mano desde el detalle de la OS.
 */
export async function linkInvoice(
    companyId: string,
    orderId: string,
    invoiceId: string,
): Promise<ServiceOrderRow> {
    await loadCompanyOrder(companyId, orderId);

    const [invoice] = await db
        .select({ id: invoices.id, serviceOrderId: invoices.serviceOrderId })
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
        .limit(1);
    if (!invoice) {
        throw new ApiError("La factura no existe en esta empresa", 404);
    }
    if (invoice.serviceOrderId && invoice.serviceOrderId !== orderId) {
        throw new ApiError("Esta factura ya está ligada a otra orden de servicio", 409);
    }

    await db
        .update(invoices)
        .set({ serviceOrderId: orderId, updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId));

    return loadCompanyOrder(companyId, orderId);
}

export interface AddQuoteInput {
    url: string;
    supplierName?: string | null;
    amount?: number | null; // centavos
    notes?: string | null;
}

/** Adjunta una cotización. La URL la genera `POST /api/upload` (R2 presignado). Solo en DRAFT. */
export async function addQuote(
    companyId: string,
    orderId: string,
    data: AddQuoteInput,
): Promise<typeof serviceOrderQuotes.$inferSelect> {
    const order = await loadCompanyOrder(companyId, orderId);
    const guard = quoteGuardError(order.status);
    if (guard) throw new ApiError(guard, 409);

    const [row] = await db
        .insert(serviceOrderQuotes)
        .values({
            serviceOrderId: orderId,
            url: data.url,
            supplierName: data.supplierName ?? null,
            amount: data.amount ?? null,
            notes: data.notes ?? null,
        })
        .returning();
    return row;
}

export interface AddEvidenceInput {
    type: "ANTES" | "DESPUES";
    url: string;
    description?: string | null;
}

/** Sube evidencia ANTES/DESPUES. Bloqueada solo en estados terminales. */
export async function addEvidence(
    companyId: string,
    orderId: string,
    data: AddEvidenceInput,
    userId: string,
): Promise<typeof serviceOrderEvidence.$inferSelect> {
    const order = await loadCompanyOrder(companyId, orderId);
    const guard = evidenceGuardError(order.status);
    if (guard) throw new ApiError(guard, 409);

    const [row] = await db
        .insert(serviceOrderEvidence)
        .values({
            serviceOrderId: orderId,
            type: data.type,
            url: data.url,
            description: data.description ?? null,
            uploadedBy: userId,
        })
        .returning();
    return row;
}

export interface ConformityActor {
    id: string;
    role: string | null | undefined;
    /** Nombre a registrar en conformitySignedBy (fallback: email o id). */
    displayName: string;
}

/**
 * Firma de conformidad del gerente: PENDING_CONFORMITY → CLOSED.
 * Registro simple userId+timestamp (open question del plan sobre firma digital).
 * El rol se verifica aquí de nuevo — la ruta también lo hace, pero el servicio
 * es el punto de verdad si se llama desde otro contexto.
 */
export async function signConformity(
    companyId: string,
    orderId: string,
    actor: ConformityActor,
): Promise<ServiceOrderRow> {
    const order = await loadCompanyOrder(companyId, orderId);
    const denial = conformityDenial(actor.role, order.status);
    if (denial) {
        throw new ApiError(denial.message, denial.kind === "ROLE" ? 403 : 409);
    }

    const [updated] = await db
        .update(serviceOrders)
        .set({
            status: "CLOSED",
            conformitySignedBy: actor.displayName,
            conformitySignedAt: new Date(),
            completedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(and(eq(serviceOrders.id, orderId), eq(serviceOrders.companyId, companyId)))
        .returning();

    if (order.complianceServiceId) {
        try {
            let providerName: string | null = null;
            if (order.serviceProviderId) {
                const [p] = await db
                    .select({ name: serviceProviders.name })
                    .from(serviceProviders)
                    .where(eq(serviceProviders.id, order.serviceProviderId))
                    .limit(1);
                providerName = p?.name ?? null;
            } else if (order.supplierId) {
                const [s] = await db
                    .select({ name: suppliers.name })
                    .from(suppliers)
                    .where(eq(suppliers.id, order.supplierId))
                    .limit(1);
                providerName = s?.name ?? null;
            }

            const [compConfig] = await db
                .select({
                    serviceType: branchComplianceServices.serviceType,
                    serviceName: branchComplianceServices.serviceName,
                })
                .from(branchComplianceServices)
                .where(eq(branchComplianceServices.id, order.complianceServiceId))
                .limit(1);

            if (compConfig) {
                await db.insert(complianceServiceHistory).values({
                    serviceConfigId: order.complianceServiceId,
                    companyId,
                    branchId: order.branchId,
                    serviceType: compConfig.serviceType,
                    serviceName: compConfig.serviceName,
                    scheduledDate: order.scheduledDate ? new Date(order.scheduledDate) : new Date(),
                    completedDate: new Date(),
                    providerId: order.serviceProviderId ?? null,
                    providerName: providerName ?? "No registrado",
                    description: order.scope ?? `OS ${order.folio}`,
                    workPerformed: order.technicalReport ?? order.justification ?? null,
                    cost: order.amount ?? null,
                    complianceStatus: "COMPLIANT",
                    createdBy: actor.id,
                });

                await db
                    .update(branchComplianceServices)
                    .set({ lastServiceDate: new Date(), updatedAt: new Date() })
                    .where(eq(branchComplianceServices.id, order.complianceServiceId));
            }
        } catch (err) {
            console.error("Failed to propagate compliance service history on OS signConformity:", err);
        }
    }

    return updated;
}
