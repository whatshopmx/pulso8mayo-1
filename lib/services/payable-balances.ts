import { sql } from "drizzle-orm";
import { expensePayments, invoices, operatingExpenses, paymentRunItems, paymentRuns, accountingPurchaseFacts, accountingEvents } from "@/lib/db/schema";
import { isAccountingPostingEnabled } from "./accounting/expense-adapter";

/** Mismos hechos confirmados que usa tesorería al validar el siguiente abono. */
export function invoiceOutstandingCents() {
  if (!isAccountingPostingEnabled()) return invoices.total;
  return sql<number>`greatest(0, ${invoices.total} - coalesce((select sum(p.amount_cents) from ${paymentRunItems} p
    join ${paymentRuns} r on r.id = p.payment_run_id where r.company_id = ${invoices.companyId}
    and p.item_type = 'INVOICE' and p.reference_id = ${invoices.id}::text and p.settlement_status = 'CONFIRMED'), 0)
    - coalesce((select sum((f.snapshot->>'totalCents')::bigint) from ${accountingPurchaseFacts} f
      join ${accountingEvents} e on e.id = f.event_id and e.status = 'POSTED'
      where f.company_id = ${invoices.companyId} and f.invoice_id = ${invoices.id} and f.kind = 'CREDIT'), 0))`.mapWith(Number);
}

export function expenseOutstandingCents() {
  if (!isAccountingPostingEnabled()) return operatingExpenses.amount;
  return sql<number>`greatest(0, ${operatingExpenses.amount} - coalesce((select sum(p.amount_cents)
    from ${expensePayments} p where p.company_id = ${operatingExpenses.companyId} and p.expense_id = ${operatingExpenses.id}
    and p.status = 'CONFIRMED'), 0))`.mapWith(Number);
}
