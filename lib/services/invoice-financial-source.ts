import { and, eq, inArray, sql } from "drizzle-orm";
import { invoices, operatingExpenses, recurringPayables, suppliers } from "@/lib/db/schema";

/**
 * La factura operativa es evidencia, incluso cuando falta su gasto: nunca es
 * deuda de compra. UNCLASSIFIED conserva el tratamiento histórico hasta T12.
 * La exclusión por vínculo también cubre asociaciones anteriores al destino.
 */
export function isStandalonePurchaseInvoice() {
  return and(
    eq(invoices.paymentStatus, "PENDING"),
    inArray(invoices.destination, ["UNCLASSIFIED", "INVENTORY_PURCHASE"]),
    sql`not exists (select 1 from ${operatingExpenses} e
      where e.company_id = ${invoices.companyId} and e.invoice_id = ${invoices.id})`,
  );
}

/** Identidad explícita primero; proveedor solo como compatibilidad histórica. */
export function invoiceCounterpartyId() {
  return sql<string | null>`coalesce(${invoices.payeeId}, ${suppliers.payeeId})`;
}

/** Evita duplicar el estimado durante el intervalo anterior al sync del cron. */
export function recurringEstimateNotReplacedByExpense() {
  return sql`not exists (select 1 from ${invoices} i
    join ${operatingExpenses} e on e.invoice_id = i.id and e.company_id = i.company_id
      and e.branch_id = i.branch_id and e.payee_id = i.payee_id and e.amount = i.total
    where i.company_id = ${recurringPayables.companyId} and i.destination = 'OPERATING_EXPENSE'
      and i.recurring_contract_id = ${recurringPayables.contractId}
      and i.payee_id = ${suppliers.payeeId}
      and (${recurringPayables.branchId} is null or i.branch_id = ${recurringPayables.branchId})
      and length(${recurringPayables.periodKey}) in (7, 10)
      and left(i.fecha, length(${recurringPayables.periodKey})) = ${recurringPayables.periodKey})`;
}
