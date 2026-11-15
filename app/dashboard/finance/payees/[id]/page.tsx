"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExpenseForm } from "@/components/finance/expense-form";
import { PayeeInvoiceAssociation } from "@/components/finance/payee-invoice-association";
import { PayeeFinanceTables } from "@/components/finance/payee-finance-tables";
import { useBranches } from "@/hooks/queries/use-branches";
import { useBranch } from "@/lib/branch-context";
import { mensajeDeError } from "@/lib/api/client-error";
import type { getPayeeFinance } from "@/lib/services/payee-finance-service";

type PayeeFinanceData = Awaited<ReturnType<typeof getPayeeFinance>>;
const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);

export default function PayeeFinancePage() {
  const { id } = useParams<{ id: string }>();
  const { selectedBranchId } = useBranch();
  return <PayeeFinanceContent key={`${id}:${selectedBranchId}`} id={id} selectedBranchId={selectedBranchId} />;
}

function PayeeFinanceContent({ id, selectedBranchId }: { id: string; selectedBranchId: string | null }) {
  const { data: branches = [] } = useBranches();
  const [page, setPage] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tab, setTab] = useState("pending");
  const [association, setAssociation] = useState<PayeeFinanceData["expenses"][number] | null>(null);
  const { data, error, isFetching: loading, refetch } = useQuery<PayeeFinanceData>({
    queryKey: ["payee-finance", id, selectedBranchId, page, from, to], retry: false,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({ page: String(page) });
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      if (selectedBranchId && selectedBranchId !== "ALL") query.set("branchId", selectedBranchId);
      const res = await fetch(`/api/finance/payees/${id}/finance?${query}`, { signal });
      const body = await res.json();
      if (!res.ok) throw new Error(mensajeDeError(body, "No se pudo consultar la contraparte."));
      return body.data;
    },
  });
  const refresh = () => { void refetch(); };

  const payablesUrl = `/dashboard/finance/payables?payeeId=${id}`;
  return <div className="container mx-auto space-y-6 py-6">
    <Button variant="ghost" asChild><Link href="/dashboard/finance/payees"><ArrowLeft className="mr-2 h-4 w-4" />Contrapartes</Link></Button>
    {loading && <div role="status" aria-label="Cargando ficha financiera" className="space-y-4"><div className="h-10 w-64 animate-pulse rounded bg-muted" /><div className="h-64 animate-pulse rounded-md bg-muted" /></div>}
    {error && <div role="alert" className="space-y-3 rounded-md border p-6"><p>{error.message}</p><Button variant="outline" onClick={refresh}>Reintentar</Button></div>}
    {data && !loading && !error && <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 min-w-0"><h1 className="text-2xl font-bold tracking-tight break-words">{data.payee.name}</h1>
          <p className="text-sm text-muted-foreground">{data.payee.taxId || "Sin RFC registrado"} · {data.payee.active ? "Contraparte activa" : "Dada de baja · historial conservado"}</p>
          <p className="text-sm text-muted-foreground">{selectedBranchId && selectedBranchId !== "ALL" ? branches.find(b => b.id === selectedBranchId)?.name || "Sucursal seleccionada" : "Movimientos de las sucursales a las que tienes acceso"}</p>
        </div>
        <div className="flex flex-wrap gap-2">{data.payee.active && <ExpenseForm branches={branches} defaultPayeeId={id} defaultBranchId={selectedBranchId && selectedBranchId !== "ALL" ? selectedBranchId : undefined} onSuccess={refresh} />}
          <Button variant="outline" asChild><Link href={payablesUrl}>Programar pago</Link></Button>
        </div>
      </header>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md bg-muted/50 p-4 sm:grid-cols-2 xl:grid-cols-4 text-sm">
        {[ ["Por pagar documentado", data.payables.confirmedCents], ["De ese saldo, vencido", data.payables.confirmedOverdueCents],
          ["Estimados sin factura", data.payables.estimatedCents], ["Gastos por aprobar", data.pendingApprovalCents] ].map(([label, value]) =>
          <div key={String(label)} className="flex flex-col gap-1"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{money(Number(value))}</dd></div>)}
      </dl>
      <Tabs value={tab} onValueChange={value => { setTab(value); setPage(0); }} className="min-w-0">
        <TabsList className="flex h-auto flex-wrap justify-start"><TabsTrigger value="pending">Pendientes</TabsTrigger><TabsTrigger value="movements">Movimientos</TabsTrigger><TabsTrigger value="documents">Documentos</TabsTrigger><TabsTrigger value="details">Datos y cuentas</TabsTrigger></TabsList>
        {(tab === "movements" || tab === "documents") && <div className="flex flex-wrap items-end gap-3 py-3">
          <div className="space-y-1"><Label htmlFor="history-from">Desde</Label><Input id="history-from" type="date" value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setPage(0); }} /></div>
          <div className="space-y-1"><Label htmlFor="history-to">Hasta</Label><Input id="history-to" type="date" value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setPage(0); }} /></div>
          {(from || to) && <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); setPage(0); }}>Limpiar fechas</Button>}
          <p className="text-xs text-muted-foreground">Las fechas filtran el historial; los saldos muestran lo pendiente actual.</p>
        </div>}
        <TabsContent value="pending" className="space-y-3 pt-3">
          <p className="text-sm text-muted-foreground">Facturas de compras, gastos autorizados y estimados. La factura de un servicio respalda el gasto; se paga una sola obligación.</p>
          <PayeeFinanceTables data={data} view="pending" onAssociate={setAssociation} />
          {data.payables.itemsTotal > data.payables.items.length && <p className="text-sm">Se muestran las {data.payables.items.length} partidas más urgentes; los saldos incluyen todas. <Link className="text-primary underline" href={payablesUrl}>Consultar cuentas por pagar</Link></p>}
        </TabsContent>
        <TabsContent value="movements" className="space-y-3 pt-3">
          <p className="text-sm text-muted-foreground">Gastos registrados y su estado de aprobación y pago. La factura vinculada respalda el mismo gasto.</p>
          <PayeeFinanceTables data={data} view="movements" onAssociate={setAssociation} />
          <Pagination page={page} more={data.moreExpenses} onChange={setPage} />
        </TabsContent>
        <TabsContent value="documents" className="space-y-3 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Facturas de proveedores vinculados, incluidas las pagadas y canceladas.</p>
            <Button variant="outline" asChild><Link href="/dashboard/inventory/invoices"><FileText className="mr-2 h-4 w-4" />Ir a facturas</Link></Button></div>
          <PayeeFinanceTables data={data} view="documents" onAssociate={setAssociation} />
          <Pagination page={page} more={data.moreDocuments} onChange={setPage} />
        </TabsContent>
        <TabsContent value="details" className="space-y-6 pt-4">
          <section className="space-y-2"><h2 className="text-lg font-semibold">Contacto</h2><p className="text-sm">{[data.payee.contactName, data.payee.email, data.payee.phone].filter(Boolean).join(" · ") || "Sin datos de contacto."}</p>
            <Button variant="outline" asChild><Link href={`/dashboard/finance/payees?edit=${id}`}>Editar datos de contacto</Link></Button></section>
          <section className="space-y-2"><h2 className="text-lg font-semibold">Proveedores vinculados</h2>
            {data.suppliers.length ? <ul className="divide-y">{data.suppliers.map(s => <li key={s.id} className="py-2 text-sm">{s.name} · {s.taxId || "Sin RFC"}</li>)}</ul> : <p className="text-sm text-muted-foreground">No hay proveedores vinculados. Sus facturas aparecerán aquí al vincularlos con esta contraparte.</p>}
            <Button variant="outline" asChild><Link href="/dashboard/inventory/suppliers">Administrar proveedores</Link></Button></section>
          <section className="space-y-3"><h2 className="text-lg font-semibold">Cuentas para pagar gastos</h2>
            {data.accounts.map(a => <p key={a.id} className="text-sm">{a.bankName} · termina en {a.last4} · {a.status === "VERIFIED" ? "Verificada" : "Pendiente de verificación"}</p>)}
            {!data.accounts.length && <p className="text-sm text-muted-foreground">Sin cuenta bancaria registrada para gastos.</p>}
            <Button variant="outline" asChild><Link href={`/dashboard/finance/payee-bank-accounts?payeeId=${id}`}><Landmark className="mr-2 h-4 w-4" />Administrar cuenta de gastos</Link></Button></section>
          <section className="space-y-3"><h2 className="text-lg font-semibold">Cuentas para pagar facturas</h2>
            <p className="text-sm text-muted-foreground">Las facturas se pagan a la cuenta verificada de su proveedor.</p>
            {data.supplierAccounts.map(a => <p key={a.id} className="text-sm">{a.supplierName} · {a.bankName} · termina en {a.last4} · {a.status === "VERIFIED" ? "Verificada" : "Pendiente de verificación"}</p>)}
            <Button variant="outline" asChild><Link href="/dashboard/finance/supplier-bank-accounts">Administrar cuentas de proveedores</Link></Button></section>
        </TabsContent>
      </Tabs>
      <PayeeInvoiceAssociation payeeId={id} expense={association} onClose={() => setAssociation(null)} onSuccess={refresh} />
    </>}
  </div>;
}

function Pagination({ page, more, onChange }: { page: number; more: boolean; onChange: (page: number) => void }) {
  if (!page && !more) return null;
  return <nav aria-label="Páginas del historial" className="flex flex-wrap items-center justify-end gap-3 text-sm">
    <Button variant="outline" disabled={page === 0} onClick={() => onChange(page - 1)}>Anterior</Button>
    <span>Página {page + 1}</span><Button variant="outline" disabled={!more} onClick={() => onChange(page + 1)}>Siguiente</Button>
  </nav>;
}
