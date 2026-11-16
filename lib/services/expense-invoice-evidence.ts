import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices, operatingExpenses, suppliers } from "@/lib/db/schema";

type Expense = Pick<typeof operatingExpenses.$inferSelect, "invoiceId" | "payeeId" | "branchId" | "amount" | "status">;

/** Las facturas de compras tienen su propio ciclo; las de servicios respaldan el gasto. */
export async function serviceInvoiceBlocker(q: Pick<typeof db, "select">, companyId: string, expense: Expense) {
  if (!expense.invoiceId) return null;
  const [invoice] = await q.select({ id: invoices.id, total: invoices.total, branchId: invoices.branchId,
    paymentStatus: invoices.paymentStatus, satStatus: invoices.satStatus, purchaseOrderId: invoices.purchaseOrderId,
    receivingReportId: invoices.receivingReportId, payeeId: invoices.payeeId,
    supplierPayeeId: suppliers.payeeId, destination: invoices.destination, currency: invoices.currency })
    .from(invoices).leftJoin(suppliers, and(eq(invoices.supplierId, suppliers.id), eq(suppliers.companyId, companyId)))
    .where(and(eq(invoices.companyId, companyId), eq(invoices.id, expense.invoiceId))).limit(1);
  if (!invoice || invoice.total !== expense.amount || invoice.branchId !== expense.branchId
    || (invoice.payeeId ?? invoice.supplierPayeeId) !== expense.payeeId
    || (invoice.payeeId && invoice.supplierPayeeId && invoice.payeeId !== invoice.supplierPayeeId)
    || (invoice.destination === "OPERATING_EXPENSE" && !invoice.payeeId)) {
    return "La factura asociada no corresponde a la contraparte, sucursal e importe del gasto. Revisa la asociación.";
  }
  if (invoice.destination === "INVENTORY_PURCHASE" || invoice.purchaseOrderId || invoice.receivingReportId) return "La factura asociada pertenece a una compra de inventario; requiere revisión de su fuente de pago.";
  if ((invoice.currency && invoice.currency !== "MXN") || (invoice.destination === "OPERATING_EXPENSE" && invoice.currency !== "MXN")) return "La factura asociada debe estar en MXN. Revisa la moneda antes de pagar el gasto.";
  if ((invoice.paymentStatus !== "PENDING" && !(invoice.paymentStatus === "PAID" && expense.status === "PAID")) || invoice.satStatus === "CANCELADO") return "La factura asociada está pagada o cancelada. Revisa el documento antes de pagar el gasto.";
  return null;
}

/** Un abono parcial no salda la factura. No se crea otra aplicación contable. */
export async function mirrorExpenseInvoicePaid(q: Pick<typeof db, "update">, companyId: string, actorId: string, expenseIds: string[]) {
  if (!expenseIds.length) return;
  await q.update(invoices).set({ paymentStatus: "PAID", paidAt: new Date(), paidBy: actorId, updatedAt: new Date() })
    .where(and(eq(invoices.companyId, companyId), eq(invoices.paymentStatus, "PENDING"),
      sql`exists (select 1 from ${operatingExpenses} e where e.company_id = ${companyId}
        and e.invoice_id = ${invoices.id} and e.status = 'PAID' and e.id in (${sql.join(expenseIds.map(id => sql`${id}::uuid`), sql`, `)}))`));
}
