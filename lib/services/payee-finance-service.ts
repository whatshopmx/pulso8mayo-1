import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { accountingJournals, branches, expensePayments, financialPeriods, invoices, operatingExpenses,
  payees, paymentRunItems, paymentRuns, suppliers, payeeBankAccounts, supplierBankAccounts } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { getAccountsPayable } from "./accounts-payable-service";
import { AuditService } from "./audit-service";

export async function getPayeeInvoiceCandidates(companyId: string, payeeId: string, expenseId: string, branchId?: string) {
  const [expense] = await db.select().from(operatingExpenses).where(and(eq(operatingExpenses.companyId, companyId),
    eq(operatingExpenses.id, expenseId), eq(operatingExpenses.payeeId, payeeId),
    branchId ? eq(operatingExpenses.branchId, branchId) : undefined));
  if (!expense) throw ApiError.notFound("Gasto no encontrado.");
  return db.select({ id: invoices.id, uuid: invoices.uuid, folio: invoices.folio, date: invoices.fecha, amountCents: invoices.total })
    .from(invoices).innerJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(and(eq(invoices.companyId, companyId), eq(suppliers.companyId, companyId), eq(suppliers.payeeId, payeeId),
      eq(invoices.branchId, expense.branchId), eq(invoices.total, expense.amount), eq(invoices.paymentStatus, "PENDING"),
      sql`${invoices.purchaseOrderId} is null and ${invoices.receivingReportId} is null`,
      sql`not exists (select 1 from ${operatingExpenses} e where e.company_id = ${companyId} and e.invoice_id = ${invoices.id})`))
    .orderBy(desc(invoices.createdAt)).limit(100);
}

export async function getPayeeFinance(companyId: string, payeeId: string, branchId?: string, page = 0, dates: { from?: string; to?: string } = {}) {
  const [payee] = await db.select().from(payees).where(and(eq(payees.companyId, companyId), eq(payees.id, payeeId)));
  if (!payee) throw ApiError.notFound("Contraparte no encontrada.");
  const expenseWhere = and(eq(operatingExpenses.companyId, companyId), eq(operatingExpenses.payeeId, payeeId),
    branchId ? eq(operatingExpenses.branchId, branchId) : undefined);
  const expenseHistoryWhere = and(expenseWhere,
    dates.from ? sql`coalesce(${operatingExpenses.businessDate}, ${operatingExpenses.createdAt}::date) >= ${dates.from}::date` : undefined,
    dates.to ? sql`coalesce(${operatingExpenses.businessDate}, ${operatingExpenses.createdAt}::date) <= ${dates.to}::date` : undefined);
  const invoiceWhere = and(eq(invoices.companyId, companyId), eq(suppliers.payeeId, payeeId),
    branchId ? eq(invoices.branchId, branchId) : undefined,
    dates.from ? sql`substring(${invoices.fecha} from 1 for 10) >= ${dates.from}` : undefined,
    dates.to ? sql`substring(${invoices.fecha} from 1 for 10) <= ${dates.to}` : undefined);
  const [payables, expenses, documents, totals, linkedSuppliers, accounts, supplierAccounts] = await Promise.all([
    getAccountsPayable({ companyId, payeeId, branchId, itemsLimit: 1000 }),
    db.select({ id: operatingExpenses.id, description: operatingExpenses.description, amountCents: operatingExpenses.amount,
      status: operatingExpenses.status, invoiceId: operatingExpenses.invoiceId, evidenceUrl: operatingExpenses.evidenceUrl,
      businessDate: operatingExpenses.businessDate, createdAt: operatingExpenses.createdAt, dueDate: operatingExpenses.dueDate,
      paidAt: operatingExpenses.paidAt, branchId: operatingExpenses.branchId, branchName: branches.name })
      .from(operatingExpenses).leftJoin(branches, eq(operatingExpenses.branchId, branches.id))
      .where(expenseHistoryWhere).orderBy(desc(operatingExpenses.createdAt), desc(operatingExpenses.id)).limit(51).offset(page * 50),
    db.select({ id: invoices.id, uuid: invoices.uuid, folio: invoices.folio, serie: invoices.serie,
      amountCents: invoices.total, status: invoices.paymentStatus, date: invoices.fecha, dueDate: invoices.dueDate,
      branchId: invoices.branchId, branchName: branches.name, supplierName: suppliers.name,
      expenseId: sql<string | null>`(select e.id from ${operatingExpenses} e where e.company_id = ${invoices.companyId}
        and e.invoice_id = ${invoices.id} order by e.created_at desc limit 1)` })
      .from(invoices).innerJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .leftJoin(branches, eq(invoices.branchId, branches.id)).where(invoiceWhere)
      .orderBy(desc(invoices.createdAt), desc(invoices.id)).limit(51).offset(page * 50),
    db.select({ pendingCents: sql<number>`coalesce(sum(${operatingExpenses.amount}) filter
      (where ${operatingExpenses.status} in ('PENDING_APPROVAL', 'PENDING_OVERBUDGET_APPROVAL')), 0)::bigint` })
      .from(operatingExpenses).where(expenseWhere),
    db.select({ id: suppliers.id, name: suppliers.name, taxId: suppliers.taxId }).from(suppliers)
      .where(and(eq(suppliers.companyId, companyId), eq(suppliers.payeeId, payeeId))),
    db.select({ id: payeeBankAccounts.id, bankName: payeeBankAccounts.bankName, last4: payeeBankAccounts.clabeLast4,
      status: payeeBankAccounts.status }).from(payeeBankAccounts)
      .where(and(eq(payeeBankAccounts.companyId, companyId), eq(payeeBankAccounts.payeeId, payeeId), eq(payeeBankAccounts.active, true))),
    db.select({ id: supplierBankAccounts.id, bankName: supplierBankAccounts.bankName, last4: supplierBankAccounts.clabeLast4,
      status: supplierBankAccounts.status, supplierId: suppliers.id, supplierName: suppliers.name }).from(supplierBankAccounts)
      .innerJoin(suppliers, eq(supplierBankAccounts.supplierId, suppliers.id))
      .where(and(eq(supplierBankAccounts.companyId, companyId), eq(suppliers.companyId, companyId),
        eq(suppliers.payeeId, payeeId), eq(supplierBankAccounts.active, true))),
  ]);
  return { payee, payables, expenses: expenses.slice(0, 50), documents: documents.slice(0, 50),
    moreExpenses: expenses.length > 50, moreDocuments: documents.length > 50,
    pendingApprovalCents: Number(totals[0]?.pendingCents ?? 0), suppliers: linkedSuppliers, accounts, supplierAccounts };
}

/** El gasto de servicio es la única fuente de pago; la factura lo respalda. */
export async function associatePayeeInvoice(input: {
  companyId: string; payeeId: string; expenseId: string; invoiceId: string; actorId: string; branchId?: string;
}) {
  return withCompanyContext({ companyId: input.companyId, actorId: input.actorId }, async tx => {
    // Mismo orden que los pagos de servicios: gasto antes de su comprobante.
    const [expense] = await tx.select().from(operatingExpenses).where(and(eq(operatingExpenses.companyId, input.companyId),
      eq(operatingExpenses.id, input.expenseId), eq(operatingExpenses.payeeId, input.payeeId),
      input.branchId ? eq(operatingExpenses.branchId, input.branchId) : undefined)).for("update");
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.companyId, input.companyId),
      eq(invoices.id, input.invoiceId))).for("update");
    if (!invoice || !expense || (input.branchId && invoice.branchId !== input.branchId)) {
      throw ApiError.notFound("No se encontraron los documentos en tu alcance.");
    }
    if (expense.invoiceId === invoice.id) return { expenseId: expense.id, invoiceId: invoice.id };
    if (expense.invoiceId) throw ApiError.conflict("Este gasto ya tiene una factura asociada.");
    // Serializa también contra la contabilización de la factura de compras.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.companyId}, 614))`);
    if (invoice.purchaseOrderId || invoice.receivingReportId) throw ApiError.badRequest(
      "Esta factura pertenece a una compra de inventario. Se paga desde Compras y no debe asociarse como gasto operativo.");
    if (!["PENDING_APPROVAL", "PENDING_OVERBUDGET_APPROVAL", "APPROVED"].includes(expense.status)
      || invoice.paymentStatus !== "PENDING" || invoice.satStatus === "CANCELADO") throw ApiError.conflict("Solo se asocian gastos vigentes y facturas pendientes de pago.");
    if (invoice.branchId !== expense.branchId || invoice.total !== expense.amount) {
      throw ApiError.badRequest("La factura y el gasto deben tener la misma sucursal y el mismo importe total.");
    }
    const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(
      eq(suppliers.companyId, input.companyId), eq(suppliers.id, invoice.supplierId!), eq(suppliers.payeeId, input.payeeId)));
    if (!supplier) throw ApiError.badRequest("Vincula primero el proveedor de la factura con esta contraparte.");
    const [duplicate] = await tx.select({ id: operatingExpenses.id }).from(operatingExpenses).where(and(
      eq(operatingExpenses.companyId, input.companyId), eq(operatingExpenses.invoiceId, invoice.id))).limit(1);
    if (duplicate) throw ApiError.conflict("La factura ya respalda otro gasto.");
    const [runItem] = await tx.select({ id: paymentRunItems.id }).from(paymentRunItems)
      .innerJoin(paymentRuns, eq(paymentRunItems.paymentRunId, paymentRuns.id))
      .where(and(eq(paymentRuns.companyId, input.companyId), inArray(paymentRunItems.referenceId, [invoice.id, expense.id]),
        sql`${paymentRuns.status} <> 'CANCELLED'`)).limit(1);
    const [payment] = await tx.select({ id: expensePayments.id }).from(expensePayments)
      .where(and(eq(expensePayments.companyId, input.companyId), eq(expensePayments.expenseId, expense.id))).limit(1);
    const [journal] = await tx.select({ id: accountingJournals.id }).from(accountingJournals)
      .where(and(eq(accountingJournals.companyId, input.companyId), sql`(
        (${accountingJournals.sourceType} = 'OPERATING_EXPENSE' and ${accountingJournals.sourceId} = ${expense.id}) or
        (${accountingJournals.sourceType} = 'PURCHASE_INVOICE' and ${accountingJournals.sourceId} = ${invoice.id}))`)).limit(1);
    if (runItem || payment || journal) throw ApiError.conflict(
      "Hay pagos, corridas o pólizas del gasto que requieren revisión antes de asociar la factura.");
    const dates = [expense.businessDate, invoice.fecha?.slice(0, 10)].filter((v): v is string => Boolean(v));
    for (const date of dates) {
      const [closed] = await tx.select({ id: financialPeriods.id }).from(financialPeriods).where(and(
        eq(financialPeriods.companyId, input.companyId), eq(financialPeriods.year, Number(date.slice(0, 4))),
        eq(financialPeriods.month, Number(date.slice(5, 7))), eq(financialPeriods.status, "CLOSED"))).limit(1);
      if (closed) throw ApiError.conflict("No se pueden asociar documentos de un periodo cerrado.");
    }
    await tx.update(operatingExpenses).set({ invoiceId: invoice.id, updatedAt: new Date() })
      .where(eq(operatingExpenses.id, expense.id));
    // El actor queda en el evento auditable de la asociación, en la misma transacción.
    await AuditService.logInventoryAction({ companyId: input.companyId, branchId: expense.branchId,
      action: "UPDATE", entityType: "PAYEE", entityId: input.payeeId, performedBy: input.actorId,
      reason: "Factura de servicio asociada; gasto como fuente única de pago", newValue: { expenseId: expense.id, invoiceId: invoice.id } }, tx);
    return { expenseId: expense.id, invoiceId: invoice.id };
  });
}
