"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mensajeDeError } from "@/lib/api/client-error";
import { ExpenseCfdiForm } from "@/components/finance/expense-cfdi-form";

interface Props {
  payeeId: string;
  payee: { name: string; taxId: string | null };
  expense: { id: string; description: string; amountCents: number; branchId: string; branchName?: string | null } | null;
  onClose: () => void; onSuccess: () => void;
}
export function PayeeInvoiceAssociation(props: Props) {
  return props.expense ? <AssociationDialog key={props.expense.id} {...props} expense={props.expense} /> : null;
}
function AssociationDialog({ payeeId, payee, expense, onClose, onSuccess }: Props & { expense: NonNullable<Props["expense"]> }) {
  const [candidates, setCandidates] = useState<Array<{ id: string; folio: string | null; uuid: string; date: string }>>([]);
  const [mode, setMode] = useState<"existing" | "xml">("existing");
  const [committed, setCommitted] = useState(false);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "existing") return;
    const control = new AbortController();
    setLoading(true); setError(null); setSelected(""); setCandidates([]);
    const query = new URLSearchParams({ expenseId: expense.id, branchId: expense.branchId });
    fetch(`/api/finance/payees/${payeeId}/finance?${query}`, { signal: control.signal })
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(mensajeDeError(body, "No se pudieron consultar las facturas."));
        if (!control.signal.aborted) setCandidates(body.data.candidates);
      }).catch(err => { if (!control.signal.aborted) setError(err.message); })
      .finally(() => { if (!control.signal.aborted) setLoading(false); });
    return () => control.abort();
  }, [expense.id, expense.branchId, payeeId, mode, reload]);
  async function associate() {
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/finance/payees/${payeeId}/finance`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expenseId: expense.id, invoiceId: selected }) });
      const body = await res.json();
      if (!res.ok) throw new Error(mensajeDeError(body, "No se pudo asociar la factura."));
      onSuccess(); onClose();
    } catch (err) { setError((err as Error).message); }
    finally { inFlight.current = false; setSaving(false); }
  }
  function close() {
    if (saving) return;
    if (committed) onSuccess();
    onClose();
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="w-[calc(100vw_-_2rem)] shadow-none" showCloseButton={!saving}>
      <DialogHeader>
        <DialogTitle>Asociar factura al gasto</DialogTitle>
        <DialogDescription>Carga el XML o elige una factura registrada. El gasto conserva su importe, aprobación y obligación de pago.</DialogDescription>
      </DialogHeader>
      <p className="break-words text-sm font-medium">{expense.description} · {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(expense.amountCents / 100)}</p>
      <div role="group" aria-label="Origen de la factura" className="flex flex-wrap gap-2">
        <Button type="button" variant={mode === "existing" ? "secondary" : "outline"} aria-pressed={mode === "existing"} disabled={saving || committed} onClick={() => setMode("existing")}>Factura existente</Button>
        <Button type="button" variant={mode === "xml" ? "secondary" : "outline"} aria-pressed={mode === "xml"} disabled={saving || committed} onClick={() => setMode("xml")}>Cargar XML</Button>
      </div>
      {mode === "xml" ? <ExpenseCfdiForm branches={[{ id: expense.branchId, name: expense.branchName || "Sucursal del gasto" }]}
        payees={[{ id: payeeId, ...payee }]} costCenters={[]} defaultBranchId={expense.branchId} defaultPayeeId={payeeId}
        existingExpense={expense} onBusyChange={setSaving} onCommitted={() => setCommitted(true)} onClose={close} /> : <>
      <p className="text-sm text-muted-foreground">Solo aparecen facturas pendientes de la misma contraparte, sucursal e importe. Comprueba el folio y la fecha.</p>
      {loading ? <p role="status" className="text-sm">Consultando facturas…</p> : candidates.length ? <div className="space-y-2">
        <Label htmlFor="associate-invoice">Factura</Label>
        <Select value={selected} onValueChange={setSelected} disabled={saving}>
          <SelectTrigger id="associate-invoice"><SelectValue placeholder="Selecciona una factura" /></SelectTrigger>
          <SelectContent>{candidates.map(c => <SelectItem key={c.id} value={c.id}>{c.folio || c.uuid} · {c.date?.slice(0, 10)}</SelectItem>)}</SelectContent>
        </Select>
      </div> : !error && <p className="rounded-md bg-muted p-3 text-sm">No hay facturas compatibles. Deben corresponder a esta contraparte, sucursal e importe, sin cancelación ni actividad financiera que impida asociarlas. Puedes cargar el XML para validarlo.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {error && <Button variant="outline" disabled={saving || loading} onClick={() => setReload(value => value + 1)}>Reintentar consulta</Button>}
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={saving}>Cancelar</Button>
        <Button onClick={associate} disabled={!selected || saving || loading}>{saving ? "Asociando…" : "Confirmar asociación"}</Button>
      </DialogFooter></>}
    </DialogContent>
  </Dialog>;
}
