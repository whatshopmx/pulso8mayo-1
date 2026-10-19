/**
 * Payables recurrentes estimados — la obligación que existe aunque el CFDI
 * no haya llegado.
 *
 * La renta venció el 1° aunque el arrendador mande factura el 10: entre
 * medias, la CxP afirmaba "no le debes nada" y el aging lo celebraba. La
 * proyección de `recurring-contract-projection.ts` conocía las fechas pero
 * era sólo cálculo del calendario de flujo; aquí las ocurrencias se vuelven
 * filas de `recurring_payables` — partida estimada de CxP con su dueDate, su
 * aging y su regla dura: **lo estimado no viaja en corridas**. El desembolso
 * sale con CFDI, nunca con un pronóstico.
 *
 * Dos operaciones, ambas idempotentes:
 *
 *   1. `ensureRecurringPayables` — genera las OPEN de las ocurrencias de
 *      cada contrato activo dentro de la ventana (pasado 60 días + futuro 60).
 *      El pasado importa: un período sin factura es una obligación VENCIDA,
 *      no un recuerdo. Dedupe por (contractId, periodKey) con índice único.
 *   2. `syncRecurringPayables` — wanneer el auto-match liga un CFDI al
 *      contrato (`invoices.recurring_contract_id`), la fila del período pasa
 *      a INVOICED: la factura real ya es la partida de CxP y la estimación
 *      queda como evidencia. Rankear igual por período: mensual por `YYYY-MM`
 *      (la factura llega cualquier día del mes), exacto para sub-mensuales.
 */

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices, recurringContracts, recurringPayables, suppliers, branches } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { occurrencesBetween } from "./recurring-contract-projection";

export type RecurringPayableStatus = "OPEN" | "INVOICED" | "CANCELLED";

/** Días hacia atrás y adelante que cubre la generación. */
export const GENERATION_WINDOW_DAYS = 60;

function fechaISO(d: Date | string | null): string | null {
    if (!d) return null;
    const iso = d instanceof Date ? d.toISOString() : d;
    return iso.slice(0, 10) || null;
}

function addDays(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * Llave del período de una ocurrencia. Sub-mensual (semana/quincena) el mismo
 * día exacto distingue los períodos; para mensuales y arriba, `YYYY-MM`: la
 * factura puede llegar el 1, el 15 o el 28 y siguen siendo el mismo período.
 */
export function periodKeyFor(occurrenceISO: string, paymentFrequency: string): string {
    const f = (paymentFrequency || "").toUpperCase();
    const SUB_MENSUAL = new Set([
        "WEEKLY", "SEMANAL", "BIWEEKLY", "QUINCENAL",
    ]);
    return SUB_MENSUAL.has(f) ? occurrenceISO.slice(0, 10) : occurrenceISO.slice(0, 7);
}

export interface EnsureResult {
    created: number;
    /** Checas por contrato — útil para diagnósticos del panel. */
    contractsConsidered: number;
}

/**
 * Generar las filas (contractId, periodKey) que faltan en la ventana. Es
 * determinista: correrlo dos veces produce la segunda vez `created: 0`.
 */
export async function ensureRecurringPayables(input: {
    companyId: string;
    /** Ventana pasada|futura: se recorta para horde. */
    backfillDays?: number;
    forwardDays?: number;
}): Promise<EnsureResult> {
    const backfill = input.backfillDays ?? GENERATION_WINDOW_DAYS;
    const forward = input.forwardDays ?? GENERATION_WINDOW_DAYS;
    const today = new Date().toISOString().slice(0, 10);
    const desde = addDays(today, -backfill);
    const hasta = addDays(today, forward);

    const contratos = await db
        .select({
            id: recurringContracts.id,
            title: recurringContracts.title,
            contractType: recurringContracts.contractType,
            supplierId: recurringContracts.supplierId,
            branchId: recurringContracts.branchId,
            baseAmountCents: recurringContracts.baseAmountCents,
            paymentFrequency: recurringContracts.paymentFrequency,
            currency: recurringContracts.currency,
            startDate: recurringContracts.startDate,
            endDate: recurringContracts.endDate,
        })
        .from(recurringContracts)
        .where(
            and(
                eq(recurringContracts.companyId, input.companyId),
                eq(recurringContracts.active, true)
            )
        );

    interface CandidateRow {
        contractId: string;
        supplierId: string;
        branchId: string | null;
        label: string;
        contractType: string;
        currency: string;
        periodKey: string;
        dueDate: string;
        estimatedAmountCents: number;
    }

    const candidatos: CandidateRow[] = [];
    for (const c of contratos) {
        const inicio = fechaISO(c.startDate);
        if (!inicio) continue;
        const ocurrencias = occurrencesBetween(
            inicio,
            c.paymentFrequency,
            desde,
            hasta,
            fechaISO(c.endDate)
        );
        for (const fecha of ocurrencias) {
            candidatos.push({
                contractId: c.id,
                supplierId: c.supplierId,
                branchId: c.branchId,
                label: c.title,
                contractType: c.contractType,
                currency: c.currency,
                periodKey: periodKeyFor(fecha, c.paymentFrequency),
                dueDate: fecha,
                estimatedAmountCents: c.baseAmountCents,
            });
        }
    }
    if (candidatos.length === 0) {
        return { created: 0, contractsConsidered: contratos.length };
    }

    let created = 0;
    for (const row of candidatos) {
        const inserted = await db
            .insert(recurringPayables)
            .values({
                companyId: input.companyId,
                contractId: row.contractId,
                supplierId: row.supplierId,
                branchId: row.branchId,
                label: row.label,
                contractType: row.contractType,
                currency: row.currency,
                periodKey: row.periodKey,
                dueDate: row.dueDate,
                estimatedAmountCents: row.estimatedAmountCents,
                status: "OPEN",
            })
            // Genuina idempotencia: el índice único (contrato, período) es la
            // fuente de verdad, no un chequeo previo con ventana de carrera.
            .onConflictDoNothing({
                target: [recurringPayables.contractId, recurringPayables.periodKey],
            })
            .returning({ id: recurringPayables.id });
        if (inserted.length > 0) created++;
    }

    return { created, contractsConsidered: contratos.length };
}

export interface RecurringPayableItem {
    id: string;
    contractId: string;
    label: string;
    contractType: string;
    supplierId: string;
    supplierName: string | null;
    payeeId: string | null;
    branchId: string | null;
    branchName: string | null;
    periodKey: string;
    dueDate: string;
    estimatedAmountCents: number;
    status: RecurringPayableStatus;
    linkedInvoiceId: string | null;
    createdAt: string;
}

export async function listRecurringPayables(params: {
    companyId: string;
    status?: RecurringPayableStatus;
    branchId?: string;
}): Promise<RecurringPayableItem[]> {
    const rows = await db
        .select({
            id: recurringPayables.id,
            contractId: recurringPayables.contractId,
            label: recurringPayables.label,
            contractType: recurringPayables.contractType,
            supplierId: recurringPayables.supplierId,
            supplierName: suppliers.name,
            payeeId: suppliers.payeeId,
            branchId: recurringPayables.branchId,
            branchName: branches.name,
            periodKey: recurringPayables.periodKey,
            dueDate: recurringPayables.dueDate,
            estimatedAmountCents: recurringPayables.estimatedAmountCents,
            status: recurringPayables.status,
            linkedInvoiceId: recurringPayables.linkedInvoiceId,
            createdAt: recurringPayables.createdAt,
        })
        .from(recurringPayables)
        .leftJoin(suppliers, eq(suppliers.id, recurringPayables.supplierId))
        .leftJoin(branches, eq(branches.id, recurringPayables.branchId))
        .where(
            and(
                eq(recurringPayables.companyId, params.companyId),
                ...(params.status
                    ? [eq(recurringPayables.status, params.status)]
                    : []),
                ...(params.branchId
                    ? [
                        or(
                            eq(recurringPayables.branchId, params.branchId),
                            isNull(recurringPayables.branchId)
                        ),
                    ]
                    : []),
            )
        )
        .orderBy(recurringPayables.dueDate);

    return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
    }));
}

export interface SyncResult {
    invoiced: number;
}

/**
 * Marcar INVOICED las filas cuyo período ya tiene CFDI lincado al contrato.
 *
 * Contra `invoices.recurringContractId` — la columna que el auto-match llena
 * al capturar el CFDI del proveedor — no decide por monto: la guía es el
 * (contrato, período). Si el subtotal trajo sorpresas, la alerta de varianza
 * de `recurring-contract-variance.ts` es la que lo grita; esta sincronización
 * sólo dice que la obligación dejó de ser un pronóstico.
 */
export async function syncRecurringPayables(input: {
    companyId: string;
}): Promise<SyncResult> {
    // Filas ABIERTAS de la empresa, con los contract_ids distintos.
    const openRows = await db
        .select({
            id: recurringPayables.id,
            contractId: recurringPayables.contractId,
            periodKey: recurringPayables.periodKey,
            dueDate: recurringPayables.dueDate,
        })
        .from(recurringPayables)
        .where(
            and(
                eq(recurringPayables.companyId, input.companyId),
                eq(recurringPayables.status, "OPEN")
            )
        );
    if (openRows.length === 0) return { invoiced: 0 };

    const contractIds = [...new Set(openRows.map((r) => r.contractId))];
    const ligaRows = await db
        .select({
            id: invoices.id,
            contractId: invoices.recurringContractId,
            fecha: invoices.fecha,
        })
        .from(invoices)
        .where(
            and(
                eq(invoices.companyId, input.companyId),
                inArray(invoices.recurringContractId, contractIds)
            )
        );
    if (ligaRows.length === 0) return { invoiced: 0 };

    const byContract = new Map<string, { fechaPrefix: string; invoiceId: string }[]>();
    for (const inv of ligaRows) {
        if (!inv.contractId) continue;
        const iso = fechaISO(inv.fecha);
        if (!iso) continue;
        const list = byContract.get(inv.contractId) ?? [];
        list.push({ fechaPrefix: iso, invoiceId: inv.id });
        byContract.set(inv.contractId, list);
    }

    let invoiced = 0;
    for (const row of openRows) {
        const ligas = byContract.get(row.contractId);
        if (!ligas || ligas.length === 0) continue;

        // Mensual "2026-02" contra la fecha del CFDI renglón por renglón.
        const match = ligas.find(
            (l) => row.periodKey.length === 7
                ? l.fechaPrefix.slice(0, 7) === row.periodKey
                : l.fechaPrefix.slice(0, 10) === row.periodKey
        );
        if (!match) continue;

        const updated = await db
            .update(recurringPayables)
            .set({
                status: "INVOICED",
                linkedInvoiceId: match.invoiceId,
                closedAt: new Date(),
                updatedAt: new Date(),
            })
            // Cerrojo doble: la fila sigue OPEN en el libro — dos corridas
            // simultáneas del sync no pueden facturarla dos veces.
            .where(
                and(
                    eq(recurringPayables.id, row.id),
                    eq(recurringPayables.status, "OPEN"),
                    isNull(recurringPayables.linkedInvoiceId)
                )
            )
            .returning({ id: recurringPayables.id });
        if (updated.length > 0) invoiced++;
    }

    return { invoiced };
}

/**
 * Baja de una estimación: contrato pausado, servicio no pagable ese período.
 * Es la única transición escrita a mano — el cron y el sync cubren el resto.
 */
export async function cancelRecurringPayable(input: {
    companyId: string;
    payableId: string;
}): Promise<void> {
    const [updated] = await db
        .update(recurringPayables)
        .set({ status: "CANCELLED", closedAt: new Date(), updatedAt: new Date() })
        .where(
            and(
                eq(recurringPayables.id, input.payableId),
                eq(recurringPayables.companyId, input.companyId),
                eq(recurringPayables.status, "OPEN")
            )
        )
        .returning({ id: recurringPayables.id });
    if (!updated) {
        throw ApiError.badRequest(
            "La estimación no existe o no está abierta (una fila INVOICED no se cancela: ya la cubre el CFDI)."
        );
    }
}

/** Ciclo completo, para el cron y el trigger manual: genera y sincroniza. */
export async function runRecurringPayablesCycle(input: {
    companyId: string;
}): Promise<EnsureResult & SyncResult> {
    const ensure = await ensureRecurringPayables({ companyId: input.companyId });
    const sync = await syncRecurringPayables({ companyId: input.companyId });
    return { ...ensure, ...sync };
}
