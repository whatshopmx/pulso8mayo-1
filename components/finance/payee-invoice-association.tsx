"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mensajeDeError } from "@/lib/api/client-error";

export function PayeeInvoiceAssociation({ payeeId, expense, onClose, onSuccess }: {
  payeeId: string; expense: { id: string; description: string; amountCents: number } | null;
  onClose: () => void; onSuccess: () => void;
}) {
  const [candidates, setCandidates] = useState<Array<{ id: string; folio: string | null; uuid: string; date: string }>>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!expense) return;
    const control = new AbortController();
    setLoading(true); setError(null); setSelected(""); setCandidates([]);
    fetch(`/api/finance/payees/${payeeId}/finance?expenseId=${expense.id}`, { signal: control.signal })
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(mensajeDeError(body, "No se pudieron consultar las facturas."));
        setCandidates(body.data.candidates);
      }).catch(err => { if (!control.signal.aborted) setError(err.message); })
      .finally(() => { if (!control.signal.aborted) setLoading(false); });
    return () => control.abort();
  }, [expense, payeeId]);
  async function associate() {
    if (!expense || !selected) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/finance/payees/${payeeId}/finance`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expenseId: expense.id, invoiceId: selected }) });
      const body = await res.json();
      if (!res.ok) throw new Error(mensajeDeError(body, "No se pudo asociar la factura."));
      onSuccess(); onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }
  return <Dialog open={Boolean(expense)} onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Asociar factura al gasto</DialogTitle>
        <DialogDescription>Elige la factura de servicio que respalda este gasto. El gasto aprobado será la única obligación de pago.</DialogDescription>
      </DialogHeader>
      <p className="text-sm font-medium">{expense?.description}</p>
      <p className="text-sm text-muted-foreground">Solo aparecen facturas pendientes de la misma contraparte, sucursal e importe. Comprueba el folio y la fecha.</p>
      {loading ? <p role="status" className="text-sm">Consultando facturas…</p> : candidates.length ? <div className="space-y-2">
        <Label htmlFor="associate-invoice">Factura</Label>
        <Select value={selected} onValueChange={setSelected} disabled={saving}>
          <SelectTrigger id="associate-invoice"><SelectValue placeholder="Selecciona una factura" /></SelectTrigger>
          <SelectContent>{candidates.map(c => <SelectItem key={c.id} value={c.id}>{c.folio || c.uuid} · {c.date?.slice(0, 10)}</SelectItem>)}</SelectContent>
        </Select>
      </div> : !error && <p className="rounded-md bg-muted p-3 text-sm">No hay facturas compatibles. Revisa que el proveedor esté vinculado a esta contraparte y que la factura tenga la misma sucursal e importe.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={associate} disabled={!selected || saving || loading}>{saving ? "Asociando…" : "Confirmar asociación"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
