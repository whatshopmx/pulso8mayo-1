import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    approvalMatrixRules,
    approvalRequests,
    branches,
    costCenters,
    serviceOrders,
    purchaseOrders,
} from "@/lib/db/schema";
import { APPROVER_ROLES_HIERARCHY, roleIsAtLeast } from "@/lib/permissions";

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

// ── Validación y persistencia de la matriz (admin) ──

export interface MatrixRuleInput {
    amountMin: number;
    amountMax: number | null;
    requiredRole: string;
    minQuotes: number;
    sequence: number;
    active?: boolean;
}

export type MatrixValidation =
    | { ok: true; warnings: string[] }
    | { ok: false; error: string; warnings: string[] };

/**
 * Valida un set de reglas antes de reemplazar la matriz:
 * - Rangos inclusivos bien formados (min ≥ 0, max ≥ min o null).
 * - Rol exigido existente en la jerarquía de aprobadores.
 * - Sin traslapes entre reglas activas (ERROR — haría cadenas ambiguas).
 * - Contigüidad solo RECOMENDADA: un hueco hace que los montos dentro de él
 *   no tengan cadena y el submit falle con 400 accionable.
 */
export function validateMatrixRules(rules: MatrixRuleInput[]): MatrixValidation {
    const warnings: string[] = [];

    for (const r of rules) {
        if (!Number.isInteger(r.amountMin) || r.amountMin < 0) {
            return { ok: false, error: `montoMin inválido: ${r.amountMin} (entero ≥ 0, centavos)`, warnings };
        }
        if (r.amountMax !== null && (!Number.isInteger(r.amountMax) || r.amountMax < r.amountMin)) {
            return { ok: false, error: `montoMax inválido para el rango desde ${r.amountMin}: debe ser entero ≥ montoMin o null (sin límite)`, warnings };
        }
        if (!Number.isInteger(r.minQuotes) || r.minQuotes < 1) {
            return { ok: false, error: `cotizacionesMin debe ser entero ≥ 1 (rango desde ${r.amountMin})`, warnings };
        }
        if (!Number.isInteger(r.sequence) || r.sequence < 1) {
            return { ok: false, error: `secuencia debe ser entero ≥ 1 (rango desde ${r.amountMin})`, warnings };
        }
        // Fail-closed igual que roleIsAtLeast: un rol mal escrito dejaría el nivel inaprobable.
        if (!(r.requiredRole in APPROVER_ROLES_HIERARCHY)) {
            return { ok: false, error: `Rol requerido desconocido: "${r.requiredRole}"`, warnings };
        }
    }

    const activeSorted = rules
        .filter((r) => r.active !== false)
        .sort((a, b) => a.amountMin - b.amountMin);

    for (let i = 1; i < activeSorted.length; i++) {
        const prev = activeSorted[i - 1];
        const curr = activeSorted[i];
        const prevMax = prev.amountMax ?? Number.POSITIVE_INFINITY;
        if (curr.amountMin <= prevMax) {
            return {
                ok: false,
                error: `Rangos traslapados: [${prev.amountMin}, ${prev.amountMax ?? "sin límite"}] y [${curr.amountMin}, ${curr.amountMax ?? "sin límite"}]`,
                warnings,
            };
        }
        if (curr.amountMin > prevMax + 1) {
            warnings.push(
                `Hueco entre $${((prevMax + 1) / 100).toFixed(2)} y $${(curr.amountMin / 100).toFixed(2)}: montos dentro de ese rango quedarán sin cadena y no podrán enviarse`,
            );
        }
    }

    if (activeSorted.length === 0 && rules.length > 0) {
        warnings.push("Todas las reglas están inactivas: ningún monto tendrá cadena de autorización");
    }

    return { ok: true, warnings };
}

/**
 * Reemplaza la matriz completa de un docType (semántica PUT). En transacción:
 * sin el replace parcial nunca queda una matriz mixta a mitad de edición.
 */
export async function replaceMatrixRules(
    companyId: string,
    docType: ApprovalDocType,
    rules: MatrixRuleInput[],
): Promise<void> {
    await db.transaction(async (tx) => {
        await tx
            .delete(approvalMatrixRules)
            .where(and(eq(approvalMatrixRules.companyId, companyId), eq(approvalMatrixRules.docType, docType)));
        if (rules.length === 0) return;
        await tx.insert(approvalMatrixRules).values(
            rules.map((r) => ({
                companyId,
                docType,
                amountMin: r.amountMin,
                amountMax: r.amountMax,
                requiredRole: r.requiredRole,
                minQuotes: r.minQuotes,
                sequence: r.sequence,
                active: r.active ?? true,
            })),
        );
    });
}

// ── Bandeja de aprobaciones (Task 6/8) ──

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

/** Carga un request opcionalmente scoped por empresa (guard multi-tenant para las rutas). */
async function loadRequestScoped(requestId: string, companyId?: string) {
    const [request] = await db
        .select()
        .from(approvalRequests)
        .where(companyId
            ? and(eq(approvalRequests.id, requestId), eq(approvalRequests.companyId, companyId))
            : eq(approvalRequests.id, requestId))
        .limit(1);
    return request ?? null;
}

/**
 * Aprueba un nivel. Al aprobar el último nivel pendiente, actualiza el
 * documento origen a APPROVED (OS) / APPROVED+approvedBy (OC).
 */
export async function approveRequest(
    requestId: string,
    actorId: string,
    actorRole: string | null | undefined,
    companyId?: string,
): Promise<ResolveOutcome> {
    const request = await loadRequestScoped(requestId, companyId);
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
    companyId?: string,
): Promise<ResolveOutcome> {
    const request = await loadRequestScoped(requestId, companyId);
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

// ── Bandeja de aprobaciones ──

export interface InboxItem {
    requestId: string;
    docType: ApprovalDocType;
    docId: string;
    level: number;
    requiredRole: string;
    minQuotes: number;
    requestedAt: Date;
    // Contexto del documento origen
    folio: string;
    docStatus: string;
    amountCents: number;
    branchId: string;
    branchName: string | null;
    costCenterId: string | null;
    costCenterCode: string | null;
    costCenterName: string | null;
    requestedBy: string;
    docCreatedAt: Date;
    // Tipo/urgencia según el tipo de documento
    docTypeLabel: string;      // CORRECTIVO / PREVENTIVO... | PROGRAMADA / STOCK / EMERGENCIA
    urgency: string | null;    // solo OS
    isEmergency: boolean;
    scope: string | null;
    notes: string | null;
}

/**
 * Bandeja actionable: requests PENDING cuyo nivel es el mínimo pendiente de su
 * documento, con rol suficiente y que no fueron creados por el propio actor
 * (segregación de funciones). Enriquecida con contexto del documento para la UI.
 * El presupuesto restante lo calcula la ruta por lotes (fuera de aquí para no
 * acoplar este módulo a budget-service).
 */
export async function listApprovalInbox(params: {
    companyId: string;
    actorId: string;
    actorRole: string | null | undefined;
    /** Alcance fijo de sucursal del tenant (GERENTE/SUPERVISOR). */
    branchId?: string;
}): Promise<InboxItem[]> {
    const pending = await db
        .select({
            id: approvalRequests.id,
            docType: approvalRequests.docType,
            docId: approvalRequests.docId,
            level: approvalRequests.level,
            requiredRole: approvalRequests.requiredRole,
            minQuotes: approvalRequests.minQuotes,
            createdAt: approvalRequests.createdAt,
        })
        .from(approvalRequests)
        .where(
            and(
                eq(approvalRequests.companyId, params.companyId),
                eq(approvalRequests.status, "PENDING"),
            ),
        )
        .orderBy(asc(approvalRequests.createdAt));
    if (pending.length === 0) return [];

    // Nivel mínimo pendiente por documento: los niveles se resuelven en orden.
    const currentLevelByDoc = new Map<string, number>();
    for (const r of pending) {
        const key = `${r.docType}:${r.docId}`;
        const cur = currentLevelByDoc.get(key);
        if (cur === undefined || r.level < cur) currentLevelByDoc.set(key, r.level);
    }

    const osIds = [...new Set(pending.filter((r) => r.docType === "OS").map((r) => r.docId))];
    const ocIds = [...new Set(pending.filter((r) => r.docType === "OC").map((r) => r.docId))];

    const [osDocs, ocDocs] = await Promise.all([
        osIds.length
            ? db.select().from(serviceOrders).where(inArray(serviceOrders.id, osIds))
            : Promise.resolve([]),
        ocIds.length
            ? db.select().from(purchaseOrders).where(inArray(purchaseOrders.id, ocIds))
            : Promise.resolve([]),
    ]);

    interface DocContext {
        folio: string;
        status: string;
        amount: number;
        branchId: string;
        costCenterId: string | null;
        requestedBy: string;
        createdAt: Date;
        typeLabel: string;
        urgency: string | null;
        isEmergency: boolean;
        scope: string | null;
        notes: string | null;
    }
    const docById = new Map<string, DocContext>();
    for (const d of osDocs) {
        docById.set(d.id, {
            folio: d.folio,
            status: d.status,
            amount: d.amount ?? 0,
            branchId: d.branchId,
            costCenterId: d.costCenterId,
            requestedBy: d.createdBy,
            createdAt: d.createdAt,
            typeLabel: d.type,
            urgency: d.urgency,
            isEmergency: d.urgency === "EMERGENCIA",
            scope: d.scope,
            notes: d.justification,
        });
    }
    for (const d of ocDocs) {
        docById.set(d.id, {
            folio: d.poNumber,
            status: d.status,
            amount: d.totalAmount ?? 0,
            branchId: d.branchId,
            costCenterId: d.costCenterId,
            requestedBy: d.requestedBy,
            createdAt: d.createdAt,
            typeLabel: d.purchaseType ?? "PROGRAMADA",
            urgency: null,
            isEmergency: d.purchaseType === "EMERGENCIA",
            scope: d.notes,
            notes: d.notes,
        });
    }

    // Nombres de sucursal y centros de costo para la bandeja.
    const branchIds = [...new Set([...docById.values()].map((d) => d.branchId))];
    const ccIds = [
        ...new Set(
            [...docById.values()].map((d) => d.costCenterId).filter((v): v is string => !!v),
        ),
    ];
    const [branchRows, ccRows] = await Promise.all([
        branchIds.length
            ? db.select({ id: branches.id, name: branches.name }).from(branches).where(inArray(branches.id, branchIds))
            : Promise.resolve([]),
        ccIds.length
            ? db.select({ id: costCenters.id, code: costCenters.code, name: costCenters.name }).from(costCenters).where(inArray(costCenters.id, ccIds))
            : Promise.resolve([]),
    ]);
    const branchNameById = new Map(branchRows.map((b) => [b.id, b.name]));
    const ccById = new Map(ccRows.map((c) => [c.id, c]));

    const items: InboxItem[] = [];
    for (const r of pending) {
        if (currentLevelByDoc.get(`${r.docType}:${r.docId}`) !== r.level) continue; // aún no es su turno
        if (!roleIsAtLeast(params.actorRole, r.requiredRole)) continue; // rol insuficiente
        const doc = docById.get(r.docId);
        if (!doc) continue; // documento eliminado u otra empresa (defensa en profundidad)
        if (doc.requestedBy === params.actorId) continue; // SELF — segregación de funciones
        if (params.branchId && doc.branchId !== params.branchId) continue; // alcance de sucursal

        items.push({
            requestId: r.id,
            docType: r.docType,
            docId: r.docId,
            level: r.level,
            requiredRole: r.requiredRole,
            minQuotes: r.minQuotes,
            requestedAt: r.createdAt,
            folio: doc.folio,
            docStatus: doc.status,
            amountCents: doc.amount,
            branchId: doc.branchId,
            branchName: branchNameById.get(doc.branchId) ?? null,
            costCenterId: doc.costCenterId,
            costCenterCode: doc.costCenterId ? ccById.get(doc.costCenterId)?.code ?? null : null,
            costCenterName: doc.costCenterId ? ccById.get(doc.costCenterId)?.name ?? null : null,
            requestedBy: doc.requestedBy,
            docCreatedAt: doc.createdAt,
            docTypeLabel: doc.typeLabel,
            urgency: doc.urgency,
            isEmergency: doc.isEmergency,
            scope: doc.scope,
            notes: doc.notes,
        });
    }
    return items;
}
