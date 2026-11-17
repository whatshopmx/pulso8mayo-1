import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { invoices, operatingExpenses, suppliers, users, type InvoiceDestination } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import type { DbExecutor } from "./fefo-allocator";
import { PURCHASE_ELIGIBLE_DESTINATIONS } from "./invoice-financial-source";

/**
 * Clasificación histórica controlada (T12).
 *
 * Este servicio NO infiere el destino de un documento que no tenga evidencia.
 * La ausencia de orden de compra no prueba que sea un gasto: un CFDI sin OC,
 * sin recepción y sin gasto queda «Por clasificar» y a la vista. Solo se
 * propone un destino cuando la relación es inequívoca y, cuando el
 * documento respalda un gasto, solo si esa relación ya existe en la base: el
 * backfill no crea gastos, no mueve pagos y no reescribe pólizas.
 *
 * La auditoría es la metadata de clasificación del propio documento (actor,
 * fecha, motivo y procedencia), que es lo que el modelo exige y lo que la
 * migración 0151 valida con una restricción de integridad.
 */

export type ClassificationOutcome = "PROPOSAL" | "PENDING" | "CONFLICT" | "ALREADY_CLASSIFIED";

export interface HistoricalInvoiceRow {
  id: string;
  uuid: string;
  fecha: string;
  total: number;
  currency: string | null;
  destination: InvoiceDestination;
  branchId: string | null;
  supplierId: string | null;
  payeeId: string | null;
  purchaseOrderId: string | null;
  receivingReportId: string | null;
  recurringContractId: string | null;
  serviceOrderId: string | null;
  paymentStatus: string;
  supplierCompanyId: string | null;
  supplierPayeeId: string | null;
  expenseCount: number;
  expensePayeeId: string | null;
  expenseBranchId: string | null;
  expenseAmount: number | null;
}

export interface ClassificationEntry {
  invoiceId: string;
  uuid: string;
  fecha: string;
  amountCents: number;
  currentDestination: InvoiceDestination;
  proposedDestination: InvoiceDestination;
  outcome: ClassificationOutcome;
  reason: string;
  conflict?: string;
  payeeId?: string | null;
  standaloneBefore: boolean;
  standaloneAfter: boolean;
}

export interface ClassificationReport {
  companyId: string;
  mode: "SIMULATION" | "APPLIED";
  generatedAt: string;
  totals: { invoices: number; amountCents: number };
  byDestination: Record<string, { count: number; amountCents: number }>;
  proposals: { count: number; amountCents: number; byDestination: Record<string, { count: number; amountCents: number }> };
  pending: { count: number; amountCents: number };
  conflicts: { count: number; amountCents: number; reasons: Record<string, number> };
  balanceImpact: {
    standaloneBeforeCents: number;
    standaloneAfterCents: number;
    deltaCents: number;
    affectedInvoices: number;
  };
  applied: { count: number; skipped: number };
  /** Alcance efectivo de la simulación: si se cortó, no cubre toda la empresa. */
  scope: { limit: number; truncated: boolean };
  entries: ClassificationEntry[];
}

export interface ClassificationOptions {
  /** Corta el alcance para revisar por lotes. */
  limit?: number;
  /** Restringe la lectura a un documento; lo usa el backfill para revalidar. */
  invoiceId?: string;
}

/** Una factura sigue siendo deuda de compra según las reglas de T03. */
export function esObligacionDeCompraStandalone(row: {
  destination: InvoiceDestination;
  expenseCount: number;
  paymentStatus: string;
}) {
  return row.paymentStatus === "PENDING"
    && (PURCHASE_ELIGIBLE_DESTINATIONS as readonly string[]).includes(row.destination)
    && row.expenseCount === 0;
}

/**
 * Decisión de clasificación para un documento histórico. Función pura: la
 * prueba la ejercita sin base de datos.
 */
export function classifyHistoricalInvoice(row: HistoricalInvoiceRow, companyId: string): {
  outcome: ClassificationOutcome;
  proposedDestination: InvoiceDestination;
  reason: string;
  conflict?: string;
  payeeId?: string | null;
} {
  if (row.destination !== "UNCLASSIFIED") {
    return { outcome: "ALREADY_CLASSIFIED", proposedDestination: row.destination, reason: "Ya tiene destino asignado" };
  }
  if (row.recurringContractId || row.serviceOrderId) {
    return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
      reason: "Contrato recurrente u orden de servicio",
      conflict: "Contrato recurrente u orden de servicio: revisar antes de clasificar" };
  }
  if (row.expenseCount > 1) {
    return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
      reason: "Varios gastos vinculados", conflict: "Más de un gasto vinculado: la relación es ambigua" };
  }
  if (row.expenseCount === 1) {
    if (row.purchaseOrderId || row.receivingReportId) {
      return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
        reason: "Gasto y OC/recepción en el mismo documento",
        conflict: "El documento tiene gasto y orden de compra o recepción: relaciones contradictorias" };
    }
    if (!row.branchId) {
      return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
        reason: "Factura sin sucursal", conflict: "El gasto operativo exige sucursal en la factura" };
    }
    if (row.expenseBranchId !== row.branchId) {
      return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
        reason: "Sucursales distintas", conflict: "El gasto y la factura están en sucursales distintas" };
    }
    if (row.currency !== "MXN") {
      return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
        reason: "Moneda no soportada", conflict: `Moneda no soportada para gasto operativo (${row.currency ?? "sin moneda"})` };
    }
    if (row.expenseAmount !== row.total) {
      return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
        reason: "Importe distinto al gasto", conflict: "El importe del gasto difiere del total de la factura" };
    }
    if (row.payeeId && row.expensePayeeId && row.payeeId !== row.expensePayeeId) {
      return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
        reason: "Contrapartes distintas", conflict: "La contraparte de la factura y la del gasto difieren" };
    }
    const payeeId = row.payeeId ?? row.expensePayeeId;
    if (!payeeId) {
      return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
        reason: "Sin contraparte directa", conflict: "El gasto operativo exige contraparte directa en la factura" };
    }
    if (row.supplierId) {
      if (row.supplierCompanyId !== companyId) {
        return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
          reason: "Proveedor de otra empresa", conflict: "El proveedor de la factura pertenece a otra empresa" };
      }
      if (row.supplierPayeeId && row.supplierPayeeId !== payeeId) {
        return { outcome: "CONFLICT", proposedDestination: "UNCLASSIFIED",
          reason: "Proveedor de otra contraparte", conflict: "El proveedor está vinculado a otra contraparte" };
      }
    }
    return { outcome: "PROPOSAL", proposedDestination: "OPERATING_EXPENSE",
      reason: "Respalda un gasto operativo vigente, sin orden de compra ni recepción", payeeId };
  }
  if (row.purchaseOrderId || row.receivingReportId) {
    return { outcome: "PROPOSAL", proposedDestination: "INVENTORY_PURCHASE",
      reason: "Documento de compra con orden de compra o recepción de inventario" };
  }
  return { outcome: "PENDING", proposedDestination: "UNCLASSIFIED",
    reason: "Sin orden de compra, recepción ni gasto vinculado: no hay evidencia suficiente" };
}

function summarize(entries: ClassificationEntry[], destination: InvoiceDestination) {
  const selected = entries.filter(entry => entry.proposedDestination === destination);
  return { count: selected.length, amountCents: selected.reduce((total, entry) => total + entry.amountCents, 0) };
}

async function readHistoricalInvoices(
  companyId: string,
  options: ClassificationOptions,
  executor: DbExecutor = db,
) {
  const expenseScope = sql`e.company_id=${companyId} and e.invoice_id=${invoices.id}`;
  const filters = [eq(invoices.companyId, companyId)];
  if (options.invoiceId) filters.push(eq(invoices.id, options.invoiceId));
  const rows = await executor.select({
    id: invoices.id,
    uuid: invoices.uuid,
    fecha: invoices.fecha,
    total: invoices.total,
    currency: invoices.currency,
    destination: invoices.destination,
    branchId: invoices.branchId,
    supplierId: invoices.supplierId,
    payeeId: invoices.payeeId,
    purchaseOrderId: invoices.purchaseOrderId,
    receivingReportId: invoices.receivingReportId,
    recurringContractId: invoices.recurringContractId,
    serviceOrderId: invoices.serviceOrderId,
    paymentStatus: invoices.paymentStatus,
    supplierCompanyId: suppliers.companyId,
    supplierPayeeId: suppliers.payeeId,
    expenseCount: sql<number>`(select count(*)::integer from ${operatingExpenses} e where ${expenseScope})`,
    expensePayeeId: sql<string | null>`(select e.payee_id from ${operatingExpenses} e where ${expenseScope} order by e.created_at desc, e.id desc limit 1)`,
    expenseBranchId: sql<string | null>`(select e.branch_id from ${operatingExpenses} e where ${expenseScope} order by e.created_at desc, e.id desc limit 1)`,
    expenseAmount: sql<number | null>`(select e.amount from ${operatingExpenses} e where ${expenseScope} order by e.created_at desc, e.id desc limit 1)`,
  })
    .from(invoices)
    .leftJoin(suppliers, and(eq(invoices.supplierId, suppliers.id), eq(suppliers.companyId, companyId)))
    .where(and(...filters))
    .orderBy(invoices.fecha, invoices.id)
    .limit(options.invoiceId ? 1 : options.limit ?? 1000);
  return rows as unknown as HistoricalInvoiceRow[];
}

function buildReport(
  companyId: string,
  mode: "SIMULATION" | "APPLIED",
  rows: HistoricalInvoiceRow[],
  limit: number,
): ClassificationReport {
  const entries: ClassificationEntry[] = rows.map(row => {
    const decision = classifyHistoricalInvoice(row, companyId);
    const standaloneBefore = esObligacionDeCompraStandalone(row);
    const standaloneAfter = decision.outcome === "PROPOSAL"
      ? esObligacionDeCompraStandalone({ ...row, destination: decision.proposedDestination })
      : standaloneBefore;
    return {
      invoiceId: row.id,
      uuid: row.uuid,
      fecha: row.fecha,
      amountCents: row.total,
      currentDestination: row.destination,
      proposedDestination: decision.proposedDestination,
      outcome: decision.outcome,
      reason: decision.reason,
      conflict: decision.conflict,
      payeeId: decision.payeeId,
      standaloneBefore,
      standaloneAfter,
    };
  });
  const byDestination: Record<string, { count: number; amountCents: number }> = {};
  for (const entry of entries) {
    const bucket = byDestination[entry.currentDestination] ?? { count: 0, amountCents: 0 };
    bucket.count += 1;
    bucket.amountCents += entry.amountCents;
    byDestination[entry.currentDestination] = bucket;
  }
  const proposals = entries.filter(entry => entry.outcome === "PROPOSAL");
  const pending = entries.filter(entry => entry.outcome === "PENDING");
  const conflicts = entries.filter(entry => entry.outcome === "CONFLICT");
  const reasons: Record<string, number> = {};
  for (const entry of conflicts) {
    const key = entry.conflict ?? entry.reason;
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
  const standaloneBeforeCents = entries.filter(entry => entry.standaloneBefore).reduce((total, entry) => total + entry.amountCents, 0);
  const standaloneAfterCents = entries.filter(entry => entry.standaloneAfter).reduce((total, entry) => total + entry.amountCents, 0);
  return {
    companyId,
    mode,
    generatedAt: new Date().toISOString(),
    totals: { invoices: entries.length, amountCents: entries.reduce((total, entry) => total + entry.amountCents, 0) },
    byDestination,
    proposals: {
      count: proposals.length,
      amountCents: proposals.reduce((total, entry) => total + entry.amountCents, 0),
      byDestination: {
        INVENTORY_PURCHASE: summarize(proposals, "INVENTORY_PURCHASE"),
        OPERATING_EXPENSE: summarize(proposals, "OPERATING_EXPENSE"),
      },
    },
    pending: { count: pending.length, amountCents: pending.reduce((total, entry) => total + entry.amountCents, 0) },
    conflicts: { count: conflicts.length, amountCents: conflicts.reduce((total, entry) => total + entry.amountCents, 0), reasons },
    balanceImpact: {
      standaloneBeforeCents,
      standaloneAfterCents,
      deltaCents: standaloneAfterCents - standaloneBeforeCents,
      affectedInvoices: entries.filter(entry => entry.standaloneBefore !== entry.standaloneAfter).length,
    },
    applied: { count: 0, skipped: 0 },
    scope: { limit, truncated: rows.length >= limit },
    entries,
  };
}

/** Reporte de solo lectura: no escribe nada y sirve para revisar antes de aplicar. */
export async function getInvoiceClassificationReport(companyId: string, options: ClassificationOptions = {}) {
  if (!companyId) throw ApiError.badRequest("Indica la empresa a revisar.");
  const rows = await readHistoricalInvoices(companyId, options);
  return buildReport(companyId, "SIMULATION", rows, options.limit ?? 1000);
}

export interface BackfillOptions extends ClassificationOptions {
  actorId: string;
  /** Motivo de la corrida; queda en la metadata de cada documento clasificado. */
  reason: string;
  /** Simulación sin escrituras (por omisión). */
  dryRun?: boolean;
  batchSize?: number;
}

/**
 * Aplica la clasificación propuesta. Es idempotente: la segunda corrida no
 * encuentra documentos «Por clasificar» con propuesta y no escribe nada.
 */
export async function backfillInvoiceClassification(companyId: string, options: BackfillOptions) {
  if (!companyId) throw ApiError.badRequest("Indica la empresa a clasificar.");
  if (!options.actorId) throw ApiError.badRequest("Indica quién ejecuta la clasificación.");
  const reason = options.reason?.trim() ?? "";
  if (reason.length < 5) throw ApiError.badRequest("El motivo de la clasificación es obligatorio.");
  const rows = await readHistoricalInvoices(companyId, options);
  const report = buildReport(companyId, options.dryRun === false ? "APPLIED" : "SIMULATION", rows, options.limit ?? 1000);
  if (options.dryRun !== false) return report;

  const [actor] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, options.actorId), eq(users.companyId, companyId))).limit(1);
  if (!actor) throw ApiError.badRequest("El actor indicado no pertenece a la empresa.");

  const proposals = report.entries.filter(entry => entry.outcome === "PROPOSAL");
  const batchSize = Math.max(1, options.batchSize ?? 50);
  let applied = 0;
  let skipped = 0;
  for (let index = 0; index < proposals.length; index += batchSize) {
    const batch = proposals.slice(index, index + batchSize);
    await withCompanyContext({ companyId, actorId: options.actorId }, async tx => {
      for (const entry of batch) {
        const [current] = await tx.select({ id: invoices.id, destination: invoices.destination })
          .from(invoices)
          .where(and(eq(invoices.id, entry.invoiceId), eq(invoices.companyId, companyId)))
          .for("update");
        if (!current || current.destination !== "UNCLASSIFIED") { skipped += 1; continue; }
        // El reporte se generó antes de abrir este lote: se vuelve a leer el
        // documento con sus relaciones ya bloqueado. Si dejó de ser
        // inequívoco (otro gasto, una OC nueva, otro importe) no se escribe
        // nada y queda a revisión.
        const [fresh] = await readHistoricalInvoices(companyId, { invoiceId: entry.invoiceId }, tx);
        if (!fresh) { skipped += 1; continue; }
        const decision = classifyHistoricalInvoice(fresh, companyId);
        if (decision.outcome !== "PROPOSAL" || decision.proposedDestination !== entry.proposedDestination) {
          skipped += 1;
          continue;
        }
        const classificationReason = `${reason} · ${decision.reason}`.slice(0, 500);
        await tx.update(invoices).set({
          destination: decision.proposedDestination,
          payeeId: decision.payeeId ?? undefined,
          classifiedAt: new Date(),
          classifiedBy: options.actorId,
          classificationReason,
          classificationSource: "BACKFILL",
          updatedAt: new Date(),
        }).where(and(eq(invoices.id, entry.invoiceId), eq(invoices.destination, "UNCLASSIFIED")));
        applied += 1;
      }
    });
  }
  return { ...report, applied: { count: applied, skipped } };
}
