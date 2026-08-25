import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    approvalMatrixRules,
    approvalRequests,
    serviceOrders,
} from "@/lib/db/schema";
import { purchaseOrders } from "@/lib/db/schema";
import { roleIsAtLeast } from "@/lib/permissions";

/**
 * Servicio de la matriz de autorización OC/OS (finzasordenes.md §4).
 *
 * Gobierna EXCLUSIVAMENTE OC/OS. Los gastos operativos sueltos siguen con
 * `expenseAuthorizationRules` + umbrales del operating-config (decisión #7);
 * aquí no se lee ninguno de esos dos mecanismos.
 *
 * Semántica de rangos: `amountMin` y `amountMax` son INCLUSIVOS en centavos
 * ("Hasta $5,000" incluye $5,000 exacto). Cada regla activa cuyo rango cubra
 * el monto es un nivel secuencial de la cadena; se aprueban en orden por
 * `sequence`. Sin reglas que cubran el monto no hay cadena → el submit debe
 * rechazar (matriz con hueco es un error de configuración, no se improvisa).
 */

export type ApprovalDocType = "OC" | "OS";

export interface MatrixRuleLike {
    amountMin: number;
    amountMax: number | null;
    requiredRole: string;
    minQuotes: number;
    sequence: number;
}

/** ¿El monto cae dentro del rango de la regla? Ambos extremos inclusivos. */
export function matchesRange(
    amountCents: number,
    rule: Pick<MatrixRuleLike, "amountMin" | "amountMax">,
): boolean {
    if (amountCents < rule.amountMin) return false;
    return rule.amountMax === null || amountCents <= rule.amountMax;
}

/**
 * Matriz default del doc (§4), en centavos:
 *   $0–5,000 GERENTE/1 · $5,001–25,000 ADMIN/2 · $25,001–100,000 OWNER/3 · >$100,000 OWNER/3
 */
export function defaultMatrixRules(): MatrixRuleLike[] {
    return [
        { amountMin: 0, amountMax: 500000, requiredRole: "GERENTE", minQuotes: 1, sequence: 1 },
        { amountMin: 500001, amountMax: 2500000, requiredRole: "ADMIN", minQuotes: 2, sequence: 2 },
        { amountMin: 2500001, amountMax: 10000000, requiredRole: "OWNER", minQuotes: 3, sequence: 3 },
        { amountMin: 10000001, amountMax: null, requiredRole: "OWNER", minQuotes: 3, sequence: 4 },
    ];
}

/** Cadena ordenada por secuencia con solo las reglas activas que cubren el monto. */
export function buildChain<T extends MatrixRuleLike & { active?: boolean }>(
    rules: T[],
    amountCents: number,
): T[] {
    return rules
        .filter((r) => r.active !== false && matchesRange(amountCents, r))
        .sort((a, b) => a.sequence - b.sequence);
}

// ── Resolución de la cadena contra la BD ──

export async function resolveApprovalChain(
    companyId: string,
    docType: ApprovalDocType,
    amountCents: number,
): Promise<MatrixRuleLike[]> {
    let rules = await db
        .select({
            amountMin: approvalMatrixRules.amountMin,
            amountMax: approvalMatrixRules.amountMax,
            requiredRole: approvalMatrixRules.requiredRole,
            minQuotes: approvalMatrixRules.minQuotes,
            sequence: approvalMatrixRules.sequence,
            active: approvalMatrixRules.active,
        })
        .from(approvalMatrixRules)
        .where(and(eq(approvalMatrixRules.companyId, companyId), eq(approvalMatrixRules.docType, docType)));

    // Seed perezoso: una empresa sin configuración recibe la matriz default del
    // doc en vez de quedarse sin cadena y bloquear todo flujo.
    if (rules.length === 0) {
        await db.insert(approvalMatrixRules).values(
            defaultMatrixRules().map((r) => ({
                companyId,
                docType,
                amountMin: r.amountMin,
                amountMax: r.amountMax,
                requiredRole: r.requiredRole,
                minQuotes: r.minQuotes,
                sequence: r.sequence,
                active: true,
            })),
        );
        rules = await db
            .select({
                amountMin: approvalMatrixRules.amountMin,
                amountMax: approvalMatrixRules.amountMax,
                requiredRole: approvalMatrixRules.requiredRole,
                minQuotes: approvalMatrixRules.minQuotes,
                sequence: approvalMatrixRules.sequence,
                active: approvalMatrixRules.active,
            })
            .from(approvalMatrixRules)
            .where(and(eq(approvalMatrixRules.companyId, companyId), eq(approvalMatrixRules.docType, docType)));
    }

    return buildChain(rules, amountCents);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | Tx;

/** Inserta un `approval_requests` por nivel de la cadena. Con `tx` participa de la transacción del submit. */
export async function createApprovalRequests(input: {
    companyId: string;
    docType: ApprovalDocType;
    docId: string;
    chain: MatrixRuleLike[];
    /** Transacción externa opcional — pásala para que folio+status+approvals sean atómicos. */
    tx?: Tx;
}): Promise<number> {
    if (input.chain.length === 0) return 0;
    const executor: DbExecutor = input.tx ?? db;
    const rows = await executor
        .insert(approvalRequests)
        .values(
            input.chain.map((level) => ({
                companyId: input.companyId,
                docType: input.docType,
                docId: input.docId,
                level: level.sequence,
                requiredRole: level.requiredRole,
                minQuotes: level.minQuotes,
                status: "PENDING" as const,
            })),
        )
        .returning({ id: approvalRequests.id });
    return rows.length;
}

// ── Resolución de niveles ──

export type ApprovalDenial = "ROLE" | "SELF" | "NOT_CURRENT_LEVEL" | null;

export interface ApprovalDecisionInput {
    /** Estado del request a resolver. */
    requestStatus: "PENDING" | "APPROVED" | "REJECTED";
    /** Nivel del request. */
    requestLevel: number;
    /** Nivel mínimo pendiente entre todos los requests del documento (o null si no hay pendientes). */
    currentPendingLevel: number | null;
    actorRole: string | null | undefined;
    actorId: string | null | undefined;
    requiredRole: string;
    /** Quien creó el documento origen — la segregación de funciones lo excluye. */
    requesterId: string | null | undefined;
}

/**
 * Misma filosofía que A16 en gastos: gana la segregación de funciones.
 * `ROLE` sin autoridad · `SELF` sería aprobar lo propio ·
 * `NOT_CURRENT_LEVEL` hay niveles previos sin resolver.
 */
export function denyApproval(input: ApprovalDecisionInput): ApprovalDenial {
    if (input.requestStatus !== "PENDING") return "NOT_CURRENT_LEVEL";
    if (input.currentPendingLevel !== null && input.requestLevel !== input.currentPendingLevel) {
        return "NOT_CURRENT_LEVEL";
    }
    const role = input.actorRole || "";
    if (!role || !roleIsAtLeast(role, input.requiredRole)) return "ROLE";
    if (!input.actorId || input.actorId === input.requesterId) return "SELF";
    return null;
}

/** El nivel pendiente más bajo de la lista (los niveles se resuelven en orden). */
export function nextPendingLevel<T extends { status: string; level: number }>(
    requests: T[],
): number | null {
    return requests
        .filter((r) => r.status === "PENDING")
        .reduce<number | null>(
            (min, r) => (min === null || r.level < min ? r.level : min),
            null,
        );
}

interface DocRef {
    companyId: string;
    docId: string;
    docType: ApprovalDocType;
}

async function loadDocRequester(ref: DocRef): Promise<string | null> {
    if (ref.docType === "OS") {
        const [row] = await db
            .select({ createdBy: serviceOrders.createdBy })
            .from(serviceOrders)
            .where(eq(serviceOrders.id, ref.docId))
            .limit(1);
        return row?.createdBy ?? null;
    }
    const [row] = await db
        .select({ requestedBy: purchaseOrders.requestedBy })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, ref.docId))
        .limit(1);
    return row?.requestedBy ?? null;
}

async function finalizeDocument(ref: DocRef, approved: boolean, actorId: string, reason?: string): Promise<void> {
    if (ref.docType === "OS") {
        await db
            .update(serviceOrders)
            .set(
                approved
                    ? { status: "APPROVED", updatedAt: new Date() }
                    : { status: "REJECTED", updatedAt: new Date() },
            )
            .where(and(eq(serviceOrders.id, ref.docId), eq(serviceOrders.companyId, ref.companyId)));
        return;
    }
    await db
        .update(purchaseOrders)
        .set(
            approved
                ? { status: "APPROVED", approvedBy: actorId, approvedAt: new Date(), updatedAt: new Date() }
                : { status: "REJECTED", rejectionReason: reason ?? null, updatedAt: new Date() },
        )
        .where(and(eq(purchaseOrders.id, ref.docId), eq(purchaseOrders.companyId, ref.companyId)));
}

export interface ResolveOutcome {
    ok: boolean;
    denial: ApprovalDenial;
    documentFinalized: boolean;
}

/**
 * Aprueba un nivel. Al aprobar el último nivel pendiente, actualiza el
 * documento origen a APPROVED (OS) / APPROVED+approvedBy (OC).
 */
export async function approveRequest(
    requestId: string,
    actorId: string,
    actorRole: string | null | undefined,
): Promise<ResolveOutcome> {
    const [request] = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, requestId))
        .limit(1);
    if (!request) throw new Error(`Solicitud de aprobación ${requestId} no encontrada`);

    const siblings = await db
        .select({ status: approvalRequests.status, level: approvalRequests.level })
        .from(approvalRequests)
        .where(
            and(
                eq(approvalRequests.docType, request.docType),
                eq(approvalRequests.docId, request.docId),
            ),
        )
        .orderBy(asc(approvalRequests.level));

    const requesterId = await loadDocRequester({
        companyId: request.companyId,
        docId: request.docId,
        docType: request.docType,
    });

    const denial = denyApproval({
        requestStatus: request.status as "PENDING" | "APPROVED" | "REJECTED",
        requestLevel: request.level,
        currentPendingLevel: nextPendingLevel(siblings),
        actorRole,
        actorId,
        requiredRole: request.requiredRole,
        requesterId,
    });
    if (denial) return { ok: false, denial, documentFinalized: false };

    await db
        .update(approvalRequests)
        .set({ status: "APPROVED", resolvedBy: actorId, resolvedAt: new Date() })
        .where(eq(approvalRequests.id, requestId));

    const remainingPending = siblings.filter(
        (s) => s.status === "PENDING" && s.level !== request.level,
    ).length;

    if (remainingPending === 0) {
        const ref: DocRef = {
            companyId: request.companyId,
            docId: request.docId,
            docType: request.docType,
        };
        await finalizeDocument(ref, true, actorId);
        return { ok: true, denial: null, documentFinalized: true };
    }
    return { ok: true, denial: null, documentFinalized: false };
}

/** Rechaza un nivel y manda el documento origen a REJECTED de inmediato. */
export async function rejectRequest(
    requestId: string,
    actorId: string,
    actorRole: string | null | undefined,
    reason: string,
): Promise<ResolveOutcome> {
    const [request] = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, requestId))
        .limit(1);
    if (!request) throw new Error(`Solicitud de aprobación ${requestId} no encontrada`);

    const siblings = await db
        .select({ status: approvalRequests.status, level: approvalRequests.level })
        .from(approvalRequests)
        .where(
            and(
                eq(approvalRequests.docType, request.docType),
                eq(approvalRequests.docId, request.docId),
            ),
        );

    const requesterId = await loadDocRequester({
        companyId: request.companyId,
        docId: request.docId,
        docType: request.docType,
    });

    const denial = denyApproval({
        requestStatus: request.status as "PENDING" | "APPROVED" | "REJECTED",
        requestLevel: request.level,
        currentPendingLevel: nextPendingLevel(siblings),
        actorRole,
        actorId,
        requiredRole: request.requiredRole,
        requesterId,
    });
    if (denial) return { ok: false, denial, documentFinalized: false };

    await db
        .update(approvalRequests)
        .set({ status: "REJECTED", resolvedBy: actorId, resolvedAt: new Date(), reason })
        .where(eq(approvalRequests.id, requestId));

    const ref: DocRef = {
        companyId: request.companyId,
        docId: request.docId,
        docType: request.docType,
    };
    await finalizeDocument(ref, false, actorId, reason);
    return { ok: true, denial: null, documentFinalized: true };
}
