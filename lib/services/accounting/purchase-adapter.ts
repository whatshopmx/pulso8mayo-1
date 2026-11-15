import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { accountingAccounts, accountingEvents, accountingJournalLines, accountingJournals, accountingPurchaseFacts,
  accountingSourceLinks, branches, companyBankAccounts, creditNotes, financialPeriods, inventoryBatches,
  inventoryItems, inventoryMovements, invoices, operatingExpenses, paymentRunItems, paymentRuns, receivingReportItems, receivingReports, suppliers, users } from "@/lib/db/schema";
import { hasPermission } from "@/lib/permissions";
import { assertCents, sumCents } from "./amounts";
import { finishAccountingEventIn, recordAccountingEventIn } from "./event-store";
import { isAccountingPostingEnabled } from "./expense-adapter";
import { insertJournalLines, postInTransaction, type AccountingContext } from "./journal-service";
import { resolveRuleIn, ruleBlockerMessage } from "./mapping-service";
import { purchasePlan, receiptValue, type PurchasePlanInput } from "./purchase-contract";

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
type Event = typeof accountingEvents.$inferSelect;
type ReceiptLine = Parameters<typeof receiptValue>[0][number] & { itemId: string; batchId?: string };
type Snapshot = PurchasePlanInput & { returnMovementIds?: string[]; receiptLines?: ReceiptLine[]; bankAccountId?: string;
  reviewReason?: string; creditTreatment?: "RETURN" | "PRICE_ADJUSTMENT" };
export const PURCHASE_EVENTS = { RECEIVING_REPORT: "PURCHASE_RECEIVED", PURCHASE_INVOICE: "PURCHASE_INVOICED",
  PURCHASE_CREDIT: "PURCHASE_CREDITED", INVOICE_PAYMENT: "INVOICE_PAID" } as const;
type Source = keyof typeof PURCHASE_EVENTS;
const day = z.iso.date().refine(value => value >= "0001-01-01");
const declaration = z.object({ sourceType: z.enum(["RECEIVING_REPORT", "PURCHASE_INVOICE", "PURCHASE_CREDIT"]),
  sourceId: z.uuid(), accountingDate: day, documentReference: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(8).max(500), valuationConfirmed: z.literal(true).optional(),
  creditTreatment: z.enum(["RETURN", "PRICE_ADJUSTMENT"]).optional(),
  returnMovementIds: z.array(z.uuid()).max(100).default([]) }).strict().superRefine((value, ctx) => {
    if (value.sourceType === "PURCHASE_CREDIT" && (!value.creditTreatment
      || (value.creditTreatment === "RETURN" && value.returnMovementIds.length === 0)
      || (value.creditTreatment === "PRICE_ADJUSTMENT" && value.returnMovementIds.length > 0))) {
      ctx.addIssue({ code: "custom", message: "Declara si la nota es una diferencia de precio o una devolución con sus movimientos físicos.", path: ["creditTreatment"] });
    }
  });
const invoiceColumns = { id: invoices.id, companyId: invoices.companyId, branchId: invoices.branchId,
  supplierId: invoices.supplierId, receivingReportId: invoices.receivingReportId, subtotal: invoices.subtotal,
  taxAmount: invoices.taxAmount, total: invoices.total, currency: invoices.currency, matchStatus: invoices.matchStatus,
  paymentStatus: invoices.paymentStatus, satStatus: invoices.satStatus, exceptionApprovedBy: invoices.exceptionApprovedBy,
  exceptionApprovedAt: invoices.exceptionApprovedAt, exceptionReason: invoices.exceptionReason,
  serviceExpenseBacked: sql<boolean>`exists (select 1 from ${operatingExpenses} e where e.company_id = ${invoices.companyId} and e.invoice_id = ${invoices.id})` };

export async function purchaseLock(tx: Tx, companyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 614))`);
}

async function invoiceOf(tx: Tx, companyId: string, id: string) {
  const [invoice] = await tx.select(invoiceColumns).from(invoices)
    .where(and(eq(invoices.companyId, companyId), eq(invoices.id, id))).limit(1);
  if (!invoice) throw ApiError.notFound("La factura no existe en esta empresa.");
  return invoice;
}

async function receiptOf(tx: Tx, companyId: string, id: string) {
  const [report] = await tx.select().from(receivingReports)
    .where(and(eq(receivingReports.companyId, companyId), eq(receivingReports.id, id))).limit(1);
  if (!report) throw ApiError.notFound("La recepción no existe en esta empresa.");
  return report;
}

async function actorIn(tx: Tx, companyId: string, actorId: string, branchId: string, role?: AccountingContext["role"]) {
  const [actor] = await tx.select({ role: users.role, branchId: users.branchId }).from(users).where(and(
    eq(users.companyId, companyId), eq(users.id, actorId), eq(users.active, true), isNull(users.deletedAt))).limit(1);
  if (!actor || (role && actor.role !== role)) throw ApiError.forbidden("El actor no está activo en esta empresa.");
  const scope = resolveBranchScope(actor.role, actor.branchId);
  if (scope.kind === "NONE" || (scope.kind === "BRANCH" && scope.branchId !== branchId)) {
    throw ApiError.forbidden("La sucursal no está en tu ámbito.");
  }
  const [branch] = await tx.select({ ownershipType: branches.ownershipType }).from(branches).where(and(
    eq(branches.companyId, companyId), eq(branches.id, branchId), eq(branches.active, true))).limit(1);
  if (!branch || branch.ownershipType !== "OWNED") throw ApiError.conflict("La recepción requiere una sucursal propia activa.");
}

async function eventOf(tx: Tx, companyId: string, sourceType: Source, sourceId: string) {
  const [event] = await tx.select().from(accountingEvents).where(and(eq(accountingEvents.companyId, companyId),
    eq(accountingEvents.sourceType, sourceType), eq(accountingEvents.sourceId, sourceId),
    eq(accountingEvents.eventType, PURCHASE_EVENTS[sourceType]), eq(accountingEvents.sourceVersion, 1))).limit(1);
  return event;
}

async function capture(tx: Tx, data: { companyId: string; actorId: string; branchId: string; sourceType: Source;
  sourceId: string; accountingDate: string; receivingReportId: string; invoiceId?: string;
  documentReference: string; snapshot?: Snapshot; pendingReason?: string }) {
  const fact = { companyId: data.companyId, actorId: data.actorId, branchId: data.branchId,
    sourceType: data.sourceType, sourceId: data.sourceId, accountingDate: data.accountingDate,
    eventType: PURCHASE_EVENTS[data.sourceType], sourceVersion: 1 };
  await recordAccountingEventIn(tx, fact);
  const event = (await eventOf(tx, data.companyId, data.sourceType, data.sourceId))!;
  if (event.accountingDate !== data.accountingDate || event.branchId !== data.branchId) {
    throw ApiError.conflict("La identidad y fecha originales del hecho son inmutables; requiere una corrección auditada.");
  }
  if (data.snapshot) {
    purchasePlan(data.snapshot);
    await tx.insert(accountingPurchaseFacts).values({ companyId: data.companyId, eventId: event.id,
      receivingReportId: data.receivingReportId, invoiceId: data.invoiceId ?? null, kind: data.snapshot.kind,
      documentReference: data.documentReference, declaredBy: data.actorId, snapshot: data.snapshot })
      .onConflictDoNothing({ target: accountingPurchaseFacts.eventId });
  } else {
    await finishAccountingEventIn(tx, event, { journal: null, reason: data.pendingReason ?? "Falta la valoración documentada." });
  }
  return postPurchaseEventIn(tx, event);
}

/** Receipt and durable accounting fact commit together. Missing evidence creates a pending fact. */
export async function capturePurchaseReceiptIn(tx: Tx, input: { companyId: string; actorId: string;
  receivingReportId: string; accountingDate: string; lines: ReceiptLine[]; documentReference: string; reviewReason?: string }) {
  if (!isAccountingPostingEnabled()) return { journal: null, reason: "La contabilización automática aún no está habilitada." };
  await purchaseLock(tx, input.companyId);
  const report = await receiptOf(tx, input.companyId, input.receivingReportId);
  await actorIn(tx, input.companyId, input.actorId, report.branchId);
  let snapshot: Snapshot | undefined, pendingReason: string | undefined;
  try { snapshot = { kind: "RECEIPT", receivedCents: receiptValue(input.lines), receiptLines: input.lines, reviewReason: input.reviewReason }; }
  catch (error) { if (!(error instanceof RangeError)) throw error; pendingReason = error.message; }
  if (!report.supplierId) { snapshot = undefined; pendingReason = "Falta el proveedor documentado de la recepción."; }
  if (report.supplierId) {
    const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(
      eq(suppliers.id, report.supplierId), eq(suppliers.companyId, input.companyId))).limit(1);
    if (!supplier) throw ApiError.conflict("El proveedor no pertenece a esta empresa.");
  }
  return capture(tx, { ...input, branchId: report.branchId, sourceType: "RECEIVING_REPORT",
    sourceId: report.id, snapshot, pendingReason });
}

async function original(tx: Tx, companyId: string, sourceType: Source, sourceId: string) {
  const event = await eventOf(tx, companyId, sourceType, sourceId);
  if (!event || event.status !== "POSTED" || !event.journalId) return null;
  const [fact] = await tx.select().from(accountingPurchaseFacts).where(and(
    eq(accountingPurchaseFacts.companyId, companyId), eq(accountingPurchaseFacts.eventId, event.id))).limit(1);
  if (!fact) return null;
  const lines = await tx.select().from(accountingJournalLines).where(and(eq(accountingJournalLines.companyId, companyId),
    eq(accountingJournalLines.journalId, event.journalId))).orderBy(asc(accountingJournalLines.lineNumber));
  return { event, fact, lines, snapshot: fact.snapshot as Snapshot };
}

/** Resolve receipt lines by their original batches, never by today's item cost. */
async function reviewedReceiptLines(tx: Tx, companyId: string, reportId: string): Promise<ReceiptLine[]> {
  const report = await receiptOf(tx, companyId, reportId);
  const batches = await tx.select({ id: inventoryBatches.id, itemId: inventoryBatches.itemId,
    quantity: inventoryBatches.initialQuantity, unitCostCents: inventoryBatches.unitCost, status: inventoryBatches.status })
    .from(inventoryBatches).innerJoin(inventoryItems, and(eq(inventoryItems.id, inventoryBatches.itemId),
      eq(inventoryItems.companyId, companyId))).where(and(eq(inventoryBatches.branchId, report.branchId),
        sql`${inventoryBatches.supplierBatchInfo}->>'receivingReportId' = ${reportId}`));
  const items = await tx.select().from(receivingReportItems).where(eq(receivingReportItems.receivingReportId, reportId));
  if (!items.length || batches.length !== items.length) throw ApiError.conflict("La recepción no tiene lotes inequívocos para revisar su valoración.");
  for (const item of items) {
    const same = batches.filter(batch => batch.itemId === item.itemId);
    if (same.length !== 1 || Number(same[0].quantity) !== item.receivedQuantity || same[0].unitCostCents !== item.unitCost) {
      throw ApiError.conflict("Las partidas y lotes de la recepción no coinciden; requiere revisión documental.");
    }
  }
  return batches.map(batch => ({ itemId: batch.itemId, batchId: batch.id, quantity: batch.quantity,
    unitCostCents: batch.unitCostCents, basis: "DOCUMENT", accepted: batch.status !== "QUARANTINED" && batch.status !== "EXPIRED" }));
}

/** Explicit review of existing documents: no additional receiving or inventory movement is created. */
export async function declarePurchase(ctx: AccountingContext, input: z.input<typeof declaration>) {
  if (!isAccountingPostingEnabled()) throw new ApiError("La contabilización automática aún no está habilitada.", 503);
  if (!hasPermission(ctx.role, "accounting", "publish")) throw ApiError.forbidden("No puedes declarar hechos contables de compra.");
  const data = declaration.parse(input);
  return withCompanyContext({ companyId: ctx.companyId, actorId: ctx.actorId }, async tx => {
    await purchaseLock(tx, ctx.companyId);
    if (data.sourceType === "RECEIVING_REPORT") {
      const report = await receiptOf(tx, ctx.companyId, data.sourceId);
      await actorIn(tx, ctx.companyId, ctx.actorId, report.branchId, ctx.role);
      if (!data.valuationConfirmed) throw ApiError.badRequest("Confirma la valoración contra el documento original de recepción.");
      return capturePurchaseReceiptIn(tx, { companyId: ctx.companyId, actorId: ctx.actorId, receivingReportId: report.id,
        accountingDate: data.accountingDate, documentReference: data.documentReference, reviewReason: data.reason,
        lines: await reviewedReceiptLines(tx, ctx.companyId, report.id) });
    }
    let invoiceId = data.sourceId;
    let credit: { id: string; subtotal: number; taxAmount: number; total: number; currency: string } | undefined;
    if (data.sourceType === "PURCHASE_CREDIT") {
      const [row] = await tx.select({ id: creditNotes.id, invoiceId: creditNotes.invoiceId,
        subtotal: creditNotes.subtotal, taxAmount: creditNotes.taxAmount, total: creditNotes.total, currency: creditNotes.currency })
        .from(creditNotes).where(and(eq(creditNotes.companyId, ctx.companyId), eq(creditNotes.id, data.sourceId))).limit(1);
      if (!row?.invoiceId) throw ApiError.notFound("La nota de crédito no está vinculada a una factura de esta empresa.");
      credit = row; invoiceId = row.invoiceId;
    }
    const invoice = await invoiceOf(tx, ctx.companyId, invoiceId);
    if (!invoice.receivingReportId) throw ApiError.conflict("La factura debe vincularse con su recepción; no crea otra adquisición.");
    const report = await receiptOf(tx, ctx.companyId, invoice.receivingReportId);
    await actorIn(tx, ctx.companyId, ctx.actorId, report.branchId, ctx.role);
    if (invoice.branchId !== report.branchId || invoice.supplierId !== report.supplierId || !invoice.supplierId) {
      throw ApiError.conflict("La factura y la recepción deben compartir empresa, sucursal y proveedor.");
    }
    if (invoice.currency !== "MXN" || (credit && credit.currency !== "MXN") || invoice.paymentStatus === "CANCELLED"
      || invoice.satStatus === "CANCELADO") throw ApiError.conflict("El documento debe ser una compra vigente en MXN.");
    if (!["MATCHED", "EXCEPTION_APPROVED"].includes(invoice.matchStatus)) throw ApiError.conflict("Resuelve la conciliación de la factura antes de contabilizar.");
    const received = await original(tx, ctx.companyId, "RECEIVING_REPORT", report.id);
    if (!received || received.snapshot.kind !== "RECEIPT") throw ApiError.conflict("Falta la recepción original contabilizada.");
    let snapshot: Snapshot;
    if (!credit) {
      const differenceApproved = invoice.matchStatus === "EXCEPTION_APPROVED" && !!invoice.exceptionApprovedBy
        && !!invoice.exceptionApprovedAt && !!invoice.exceptionReason?.trim();
      snapshot = { kind: "INVOICE", receivedCents: received.snapshot.receivedCents, netCents: invoice.subtotal,
        taxCents: invoice.taxAmount, totalCents: invoice.total, differenceApproved };
    } else {
      const invoiced = await original(tx, ctx.companyId, "PURCHASE_INVOICE", invoice.id);
      if (!invoiced) throw ApiError.conflict("Falta la obligación original contabilizada.");
      const movementIds = [...new Set(data.returnMovementIds)];
      let returnedCents = 0;
      if (movementIds.length) {
        const movements = await tx.select().from(inventoryMovements).where(inArray(inventoryMovements.id, movementIds));
        if (movements.length !== movementIds.length) throw ApiError.notFound("No se encontraron las devoluciones documentadas.");
        const valuation: ReceiptLine[] = [];
        for (const movement of movements) {
          const line = received.snapshot.receiptLines?.find(line => line.batchId === movement.batchId && line.itemId === movement.itemId);
          if (!line || movement.type !== "RETURN" || Number(movement.quantityChange) >= 0 || movement.branchId !== report.branchId) {
            throw ApiError.conflict("La devolución debe ser una salida del lote y sucursal de la recepción original.");
          }
          const returned = Math.abs(Number(movement.quantityChange));
          const prior = await tx.select({ quantity: sql<string>`coalesce(sum(abs(${inventoryMovements.quantityChange})),0)::text` })
            .from(inventoryMovements).where(and(eq(inventoryMovements.batchId, movement.batchId!), eq(inventoryMovements.type, "RETURN"),
              sql`${inventoryMovements.quantityChange}<0`));
          if (Number(prior[0].quantity) > Number(line.quantity)) throw ApiError.conflict("La devolución física excede la cantidad recibida.");
          valuation.push({ ...line, quantity: String(returned), accepted: true, basis: "DOCUMENT" });
        }
        returnedCents = receiptValue(valuation);
      }
      snapshot = { kind: "CREDIT", returnedCents, netCents: credit.subtotal, taxCents: credit.taxAmount,
        totalCents: credit.total, returnMovementIds: movementIds, creditTreatment: data.creditTreatment };
    }
    return capture(tx, { companyId: ctx.companyId, actorId: ctx.actorId, branchId: report.branchId,
      sourceType: data.sourceType, sourceId: data.sourceId, accountingDate: data.accountingDate,
      receivingReportId: report.id, invoiceId: invoice.id, documentReference: data.documentReference,
      snapshot: { ...snapshot, reviewReason: data.reason } });
  });
}

/** Adapter dispatch used by the existing durable worker. Only frozen values are retried. */
export async function postPurchaseEventIn(tx: Tx, event: Event) {
  await purchaseLock(tx, event.companyId);
  const current = await eventOf(tx, event.companyId, event.sourceType as Source, event.sourceId);
  if (!current) throw ApiError.notFound("El hecho de compra no existe.");
  if (current.status === "POSTED") return { journal: { id: current.journalId! }, reason: null };
  const pending = async (reason: string) => {
    const result = { journal: null, reason }; await finishAccountingEventIn(tx, current, result); return result;
  };
  const [fact] = await tx.select().from(accountingPurchaseFacts).where(and(eq(accountingPurchaseFacts.companyId, event.companyId),
    eq(accountingPurchaseFacts.eventId, event.id))).limit(1);
  if (!fact || !event.accountingDate) return pending("Falta la declaración de valoración, aceptación y fecha contable de la compra.");
  const snapshot = fact.snapshot as Snapshot;
  const plan = purchasePlan(snapshot);
  if (fact.invoiceId) {
    const source = await invoiceOf(tx, event.companyId, fact.invoiceId);
    const reason = invoiceBlocker(source);
    if (reason) return pending(reason);
  }
  const receipt = snapshot.kind !== "RECEIPT" ? await original(tx, event.companyId, "RECEIVING_REPORT", fact.receivingReportId) : null;
  const invoice = ["CREDIT", "PAYMENT"].includes(snapshot.kind) && fact.invoiceId
    ? await original(tx, event.companyId, "PURCHASE_INVOICE", fact.invoiceId) : null;
  if (snapshot.kind !== "RECEIPT" && !receipt) return pending("Falta la recepción original contabilizada.");
  if (["CREDIT", "PAYMENT"].includes(snapshot.kind) && !invoice) return pending("Falta la obligación original contabilizada.");
  const [closed] = await tx.select({ id: financialPeriods.id }).from(financialPeriods).where(and(eq(financialPeriods.companyId, event.companyId),
    eq(financialPeriods.year, Number(event.accountingDate.slice(0, 4))), eq(financialPeriods.month, Number(event.accountingDate.slice(5, 7))),
    eq(financialPeriods.status, "CLOSED"))).limit(1);
  if (closed) return pending("El periodo de la compra está cerrado; requiere revisión antes de publicar.");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${event.companyId},505))`);
  const rule = await resolveRuleIn(tx, event.companyId, event.eventType, event.accountingDate);
  const blocker = ruleBlockerMessage(rule);
  if (blocker) return pending(blocker);
  const lines: Parameters<typeof insertJournalLines>[3] = [];
  for (const line of plan) {
    const entry = rule.entries.find(entry => entry.role === line.role);
    let accountId = entry?.accountId, costCenterId = entry?.costCenterId ?? null;
    if (snapshot.kind === "PAYMENT" && line.role === "PAYMENT_SOURCE") {
      const [bank] = await tx.select({ accountId: accountingSourceLinks.accountId }).from(companyBankAccounts)
        .innerJoin(accountingSourceLinks, and(eq(accountingSourceLinks.companyId, event.companyId),
          eq(accountingSourceLinks.bankAccountId, companyBankAccounts.id))).where(and(eq(companyBankAccounts.companyId, event.companyId),
          eq(companyBankAccounts.id, snapshot.bankAccountId!), eq(companyBankAccounts.active, true), eq(companyBankAccounts.currency, "MXN"))).limit(1);
      accountId = bank?.accountId; costCenterId = null;
    }
    if (!accountId) return pending(`Falta una cuenta explícita para ${line.role} en la compra.`);
    const anchor = line.role === "RECEIVING_PENDING" && snapshot.kind === "INVOICE" ? receipt
      : line.role === "INVENTORY" && snapshot.kind === "CREDIT" ? receipt
      : ["PAYABLE", "RECOVERABLE_TAX"].includes(line.role) && ["CREDIT", "PAYMENT"].includes(snapshot.kind) ? invoice : null;
    if (anchor) {
      const saved = anchor.lines.filter(saved => saved.memo === `PURCHASE:${line.role}`);
      if (saved.length !== 1 || saved[0].accountId !== accountId || saved[0].costCenterId !== costCenterId) {
        return pending(`La cuenta o centro de ${line.role} no coincide con la obligación/valoración original.`);
      }
    }
    const [account] = await tx.select({ kind: accountingAccounts.kind, active: accountingAccounts.active,
      postable: accountingAccounts.postable, validFrom: accountingAccounts.validFrom, validTo: accountingAccounts.validTo })
      .from(accountingAccounts).where(and(eq(accountingAccounts.companyId, event.companyId), eq(accountingAccounts.id, accountId))).limit(1);
    const kind = ["PAYABLE", "RECEIVING_PENDING"].includes(line.role) ? "LIABILITY" : line.role === "PURCHASE_VARIANCE" ? "EXPENSE" : "ASSET";
    if (!account || account.kind !== kind || !account.active || !account.postable || account.validFrom > event.accountingDate
      || (account.validTo && account.validTo < event.accountingDate)) return pending(`La cuenta de ${line.role} no es válida en la fecha del hecho.`);
    lines.push({ accountId, costCenterId, debitCents: line.debitCents, creditCents: line.creditCents, memo: `PURCHASE:${line.role}` });
  }
  // Capacity is checked before writing so an unsupported source remains PENDING.
  if (invoice && snapshot.kind !== "RECEIPT" && snapshot.kind !== "INVOICE") {
    const used = await postedApplications(tx, event.companyId, fact.invoiceId!);
    const base = invoice.snapshot;
    if (base.kind !== "INVOICE") return pending("La obligación original no tiene una valoración válida.");
    const total = snapshot.kind === "PAYMENT" ? snapshot.amountCents : snapshot.totalCents;
    const committedCash = snapshot.kind === "CREDIT" ? await confirmedInvoicePaidIn(tx, event.companyId, fact.invoiceId!) : 0;
    if (sumCents([used.total, total]) > base.totalCents || (snapshot.kind === "CREDIT" && (
      sumCents([committedCash, used.net, used.tax, total]) > base.totalCents ||
      sumCents([used.net, snapshot.netCents]) > base.netCents || sumCents([used.tax, snapshot.taxCents]) > base.taxCents
      || sumCents([used.returned, snapshot.returnedCents]) > base.receivedCents))) return pending("El pago o devolución excede la obligación original.");
  }
  const [draft] = await tx.insert(accountingJournals).values({ companyId: event.companyId, branchId: event.branchId,
    accountingDate: event.accountingDate, businessDate: event.accountingDate, description: `Compra: ${fact.documentReference}`,
    sourceType: event.sourceType, sourceId: event.sourceId, eventType: event.eventType, sourceVersion: event.sourceVersion,
    ruleId: rule.rule!.id, ruleVersion: rule.rule!.version, createdBy: event.actorId, updatedBy: event.actorId }).returning();
  await insertJournalLines(tx, event.companyId, draft.id, lines);
  const journal = await postInTransaction(tx, event.companyId, event.actorId, draft.id, draft.version, "Hecho de compra documentado y revisado.");
  await finishAccountingEventIn(tx, event, { journal, reason: null });
  return { journal, reason: null };
}

async function postedApplications(tx: Tx, companyId: string, invoiceId: string) {
  const facts = await tx.select({ snapshot: accountingPurchaseFacts.snapshot }).from(accountingPurchaseFacts)
    .innerJoin(accountingEvents, and(eq(accountingEvents.id, accountingPurchaseFacts.eventId), eq(accountingEvents.status, "POSTED")))
    .where(and(eq(accountingPurchaseFacts.companyId, companyId), eq(accountingPurchaseFacts.invoiceId, invoiceId),
      inArray(accountingPurchaseFacts.kind, ["CREDIT", "PAYMENT"])));
  const totals = { total: 0, net: 0, tax: 0, returned: 0 };
  for (const { snapshot: raw } of facts) {
    const value = raw as Snapshot;
    if (value.kind === "PAYMENT") totals.total = sumCents([totals.total, value.amountCents]);
    if (value.kind === "CREDIT") {
      totals.total = sumCents([totals.total, value.totalCents]); totals.net = sumCents([totals.net, value.netCents]);
      totals.tax = sumCents([totals.tax, value.taxCents]); totals.returned = sumCents([totals.returned, value.returnedCents]);
    }
  }
  return totals;
}

function invoiceBlocker(invoice: Awaited<ReturnType<typeof invoiceOf>>) {
  if (invoice.serviceExpenseBacked) return "Esta factura respalda un gasto operativo; se contabiliza y paga mediante ese gasto para evitar duplicados.";
  if (invoice.currency !== "MXN" || invoice.paymentStatus === "CANCELLED" || invoice.satStatus === "CANCELADO") {
    return "La factura está cancelada o no es una compra vigente en MXN.";
  }
  if (!["MATCHED", "EXCEPTION_APPROVED"].includes(invoice.matchStatus)) return "La factura requiere resolver su conciliación antes de contabilizar o pagar.";
  return null;
}

async function confirmedInvoicePaidIn(tx: Tx, companyId: string, invoiceId: string) {
  const [paid] = await tx.select({ total: sql<string>`coalesce(sum(${paymentRunItems.amountCents}::bigint),0)::text` }).from(paymentRunItems)
    .innerJoin(paymentRuns, and(eq(paymentRuns.id, paymentRunItems.paymentRunId), eq(paymentRuns.companyId, companyId)))
    .where(and(eq(paymentRunItems.itemType, "INVOICE"), eq(paymentRunItems.referenceId, invoiceId), eq(paymentRunItems.settlementStatus, "CONFIRMED")));
  return assertCents(Number(paid.total));
}

/** Confirmed treasury applications, including those awaiting accounting, consume the operational balance. */
export async function remainingInvoiceCentsIn(tx: Tx, companyId: string, invoiceId: string) {
  await purchaseLock(tx, companyId);
  const invoice = await invoiceOf(tx, companyId, invoiceId);
  const blocker = invoiceBlocker(invoice);
  if (blocker) throw ApiError.conflict(blocker);
  const paidCents = await confirmedInvoicePaidIn(tx, companyId, invoiceId);
  const applications = await postedApplications(tx, companyId, invoiceId);
  // Credits have no separate cash leg; only their posted amount reduces the payable.
  const credits = await tx.select({ snapshot: accountingPurchaseFacts.snapshot }).from(accountingPurchaseFacts)
    .innerJoin(accountingEvents, and(eq(accountingEvents.id, accountingPurchaseFacts.eventId), eq(accountingEvents.status, "POSTED")))
    .where(and(eq(accountingPurchaseFacts.companyId, companyId), eq(accountingPurchaseFacts.invoiceId, invoiceId), eq(accountingPurchaseFacts.kind, "CREDIT")));
  const creditCents = sumCents(credits.map(row => Number(row.snapshot.totalCents)));
  if (invoice.paymentStatus === "PAID" && paidCents + creditCents < invoice.total) {
    throw ApiError.conflict("La factura heredada figura pagada sin aplicaciones suficientes; requiere revisión auditada.");
  }
  if (paidCents + creditCents > invoice.total || applications.total > invoice.total) throw ApiError.conflict("Las aplicaciones exceden la factura original.");
  return invoice.total - paidCents - creditCents;
}

/** Called after treasury confirms the item, inside that same transaction. */
export async function captureInvoicePaymentIn(tx: Tx, companyId: string, actorId: string, itemId: string) {
  await purchaseLock(tx, companyId);
  const [item] = await tx.select({ id: paymentRunItems.id, invoiceId: paymentRunItems.referenceId,
    amountCents: paymentRunItems.amountCents, settledAt: paymentRunItems.settledAt, status: paymentRunItems.settlementStatus,
    bankAccountId: paymentRuns.sourceBankAccountId }).from(paymentRunItems).innerJoin(paymentRuns, and(
      eq(paymentRuns.id, paymentRunItems.paymentRunId), eq(paymentRuns.companyId, companyId)))
    .where(and(eq(paymentRunItems.id, itemId), eq(paymentRunItems.itemType, "INVOICE"))).limit(1);
  if (!item || item.status !== "CONFIRMED" || !item.settledAt) throw ApiError.conflict("El pago de factura no está confirmado con fecha.");
  const invoice = await invoiceOf(tx, companyId, item.invoiceId);
  if (!invoice.receivingReportId || !invoice.branchId) throw ApiError.conflict("El pago requiere factura vinculada con recepción y sucursal.");
  await actorIn(tx, companyId, actorId, invoice.branchId);
  const remaining = await remainingInvoiceCentsIn(tx, companyId, invoice.id);
  const result = await capture(tx, { companyId, actorId, branchId: invoice.branchId, sourceType: "INVOICE_PAYMENT", sourceId: item.id,
    accountingDate: item.settledAt.toISOString().slice(0, 10), receivingReportId: invoice.receivingReportId, invoiceId: invoice.id,
    documentReference: `Partida confirmada ${item.id}`, snapshot: { kind: "PAYMENT", amountCents: item.amountCents,
      bankAccountId: item.bankAccountId ?? undefined } });
  await tx.update(invoices).set({ paymentStatus: remaining === 0 ? "PAID" : "PENDING", paidAt: remaining === 0 ? item.settledAt : null,
    paidBy: remaining === 0 ? actorId : null }).where(and(eq(invoices.companyId, companyId), eq(invoices.id, invoice.id)));
  return result;
}
