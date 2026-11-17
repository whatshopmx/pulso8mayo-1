"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { getPayeeFinance } from "@/lib/services/payee-finance-service";
import type { InvoiceDestination } from "@/lib/db/schema";

type Data = Awaited<ReturnType<typeof getPayeeFinance>>;
export const INVOICE_DESTINATION_LABELS: Record<InvoiceDestination, string> = {
  INVENTORY_PURCHASE: "Compra de inventario", OPERATING_EXPENSE: "Gasto operativo", UNCLASSIFIED: "Por clasificar",
};
const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
const status: Record<string, string> = { PENDING: "Pendiente de pago", PAID: "Pagado", CANCELLED: "Cancelado",
  APPROVED: "Autorizado", PENDING_APPROVAL: "Por aprobar", PENDING_OVERBUDGET_APPROVAL: "Requiere aprobación de sobrepresupuesto", REJECTED: "Rechazado" };

export function PayeeFinanceTables({ data, view, onAssociate }: {
  data: Data; view: "pending" | "movements" | "documents";
  onAssociate: (expense: Data["expenses"][number]) => void;
}) {
  const empty = view === "pending" ? !data.payables.items.length : view === "movements" ? !data.expenses.length : !data.documents.length;
  if (empty) return <div className="rounded-md border p-8 text-sm text-muted-foreground" role="status">
    <p>{view === "pending" ? "Esta contraparte no tiene obligaciones pendientes en este alcance." : view === "movements" ? "No hay gastos registrados en esta página del historial." : "No hay documentos que coincidan con estos filtros."}</p>
    {view === "documents" && <p className="mt-2">{data.payee.active
      ? "Para cargar un CFDI de gasto usa Nuevo Gasto Operativo → Cargar CFDI. Para un gasto registrado, abre Movimientos → Asociar factura."
      : "La contraparte está dada de baja. Puedes cambiar los filtros para consultar su historial."}</p>}
  </div>;
  return <div className="overflow-x-auto rounded-md border"><Table>
    <TableHeader><TableRow><TableHead>{view === "documents" ? "Factura" : "Concepto"}</TableHead><TableHead>Sucursal</TableHead>
      <TableHead>{view === "pending" ? "Vencimiento" : "Fecha"}</TableHead><TableHead>Estado y documentos</TableHead>
      <TableHead className="text-right">{view === "pending" ? "Por pagar" : "Importe"}</TableHead><TableHead>Acción</TableHead></TableRow></TableHeader>
    <TableBody>
      {view === "pending" && data.payables.items.map(item => <TableRow key={`${item.source}:${item.id}`}>
        <TableCell className="min-w-48 max-w-80 whitespace-normal"><p className="font-medium">{item.reference}</p><p className="text-xs text-muted-foreground">{item.source === "INVOICE"
          ? item.invoiceDestination === "INVENTORY_PURCHASE" ? "Factura de compra de inventario" : item.invoiceDestination === "OPERATING_EXPENSE" ? "CFDI de gasto operativo" : "Factura por clasificar"
          : item.source === "OPERATING_EXPENSE" ? "Gasto operativo" : "Estimado sin factura"}</p></TableCell>
        <TableCell>{item.branchName || "Corporativo"}</TableCell><TableCell>{item.dueDate || "Sin vencimiento"}{item.bucket === "OVERDUE" && <p className="text-xs text-destructive">Vencido</p>}</TableCell>
        <TableCell className="min-w-48 max-w-80 whitespace-normal"><span className="text-sm">{item.blockedReason || (item.canPay ? "Disponible para programar" : "No disponible para programar")}</span>
          {item.source === "INVOICE" && (!item.invoiceDestination || item.invoiceDestination === "UNCLASSIFIED") && <p className="mt-1 text-xs text-muted-foreground">Elegibilidad histórica · clasificación pendiente</p>}</TableCell>
        <TableCell className="text-right tabular-nums whitespace-nowrap">{money(item.amountCents)}</TableCell>
        <TableCell><Button variant="ghost" size="sm" asChild><Link href={item.source === "OPERATING_EXPENSE"
          ? `/dashboard/finance/expenses?payeeId=${data.payee.id}&focus=${item.id}`
          : `/dashboard/finance/payables?payeeId=${data.payee.id}&focus=${item.id}`}>Revisar</Link></Button></TableCell>
      </TableRow>)}
      {view === "movements" && data.expenses.map(expense => <TableRow key={expense.id}>
        <TableCell className="min-w-48 max-w-80 whitespace-normal font-medium">{expense.description}</TableCell><TableCell>{expense.branchName}</TableCell>
        <TableCell className="whitespace-nowrap">{expense.businessDate || String(expense.createdAt).slice(0, 10)}</TableCell>
        <TableCell className="min-w-40 space-y-1"><Badge variant="outline">{status[expense.status] || expense.status}</Badge>
          {expense.invoiceId && <><p className="text-xs text-muted-foreground">Factura asociada · pago único</p>
            <a className="block text-sm text-primary underline" href={`/api/finance/expense-invoices/${encodeURIComponent(expense.invoiceId)}/xml`}>Descargar XML</a></>}
          {expense.evidenceUrl && <a href={expense.evidenceUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary underline">Ver comprobante</a>}</TableCell>
        <TableCell className="text-right tabular-nums whitespace-nowrap">{money(expense.amountCents)}</TableCell>
        <TableCell>{!expense.invoiceId && ["APPROVED", "PENDING_APPROVAL", "PENDING_OVERBUDGET_APPROVAL"].includes(expense.status)
          ? <Button variant="outline" size="sm" onClick={() => onAssociate(expense)}>Asociar factura</Button>
          : <Button variant="ghost" size="sm" asChild><Link href={`/dashboard/finance/expenses?payeeId=${data.payee.id}&focus=${expense.id}`}>Ver gasto</Link></Button>}</TableCell>
      </TableRow>)}
      {view === "documents" && data.documents.map(doc => <TableRow key={doc.id}>
        <TableCell className="min-w-48 max-w-80 whitespace-normal"><p className="font-medium">{[doc.serie, doc.folio].filter(Boolean).join("-") || "CFDI sin folio"}</p><p className="break-all text-xs text-muted-foreground">{doc.uuid}</p></TableCell>
        <TableCell>{doc.branchName || "Sin sucursal"}</TableCell><TableCell>{doc.date?.slice(0, 10) || "Sin fecha"}</TableCell>
        <TableCell className="min-w-56 space-y-1 whitespace-normal">
          <p className="text-sm font-medium">{INVOICE_DESTINATION_LABELS[doc.destination]}</p>
          <Badge variant="outline">{doc.satStatus === "CANCELADO" ? "Cancelado en SAT" : status[doc.status] || doc.status}</Badge>
          <p className="text-xs text-muted-foreground">{doc.expenseId
            ? doc.expenseCount === 1 && doc.expenseAmountCents === doc.amountCents && doc.destination !== "INVENTORY_PURCHASE" && !doc.identityConflict ? "Respalda un gasto · pago único" : "Vínculo de gasto por revisar"
            : doc.hasReceivingReport ? "Con recepción de inventario" : doc.hasPurchaseOrder ? "Con orden de compra"
            : doc.hasRecurringContract ? "Con contrato recurrente" : doc.hasServiceOrder ? "Con orden de servicio"
            : doc.destination === "OPERATING_EXPENSE" ? "Sin gasto vinculado" : "Sin origen vinculado"}</p>
          {doc.requiresReview && <p className="text-xs text-warning-text">Requiere revisión</p>}
        </TableCell>
        <TableCell className="text-right tabular-nums whitespace-nowrap">{money(doc.amountCents)}</TableCell>
        <TableCell className="space-y-1"><DocumentAction document={doc} payeeId={data.payee.id} /></TableCell>
      </TableRow>)}
    </TableBody>
  </Table></div>;
}

function DocumentAction({ document: doc, payeeId }: { document: Data["documents"][number]; payeeId: string }) {
  const singleExpense = Boolean(doc.expenseId && doc.expenseCount === 1);
  const expenseReview = doc.destination === "OPERATING_EXPENSE" || doc.expenseCount > 1;
  const url = singleExpense ? `/dashboard/finance/expenses?payeeId=${payeeId}&focus=${doc.expenseId}`
    : expenseReview ? `/dashboard/finance/expenses?payeeId=${payeeId}` : `/dashboard/inventory/invoices?focus=${doc.id}`;
  const label = singleExpense ? doc.requiresReview && doc.destination !== "UNCLASSIFIED" ? "Revisar gasto" : "Ver gasto"
    : expenseReview ? "Revisar gastos" : doc.destination === "INVENTORY_PURCHASE" ? "Ver compra" : "Revisar factura";
  return <><Button variant="ghost" size="sm" asChild><Link href={url}>{label}</Link></Button>
    {singleExpense && <a className="block text-sm text-primary underline" href={`/api/finance/expense-invoices/${encodeURIComponent(doc.id)}/xml`}>Descargar XML</a>}</>;
}
