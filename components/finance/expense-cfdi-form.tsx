"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mensajeDeError } from "@/lib/api/client-error";
import type { OperatingCfdiPreview } from "@/lib/services/operating-cfdi-parser";
import type { OperatingCfdiConfirmation } from "@/lib/services/operating-cfdi-confirm";

interface Props {
  branches: { id: string; name: string }[];
  payees: { id: string; name: string; taxId: string | null }[];
  costCenters: { id: string; code: string; name: string }[];
  defaultBranchId?: string;
  defaultPayeeId?: string;
  existingExpense?: { id: string; amountCents: number };
  onBusyChange: (busy: boolean) => void;
  onCommitted: () => void;
  onClose: () => void;
}
const selectClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
const rfc = (value?: string | null) => value?.trim().toUpperCase().replace(/\s/g, "");

/** La vista previa solo vive en este diálogo. El servidor revalida el archivo al confirmar. */
export function ExpenseCfdiForm({ branches, payees, costCenters, defaultBranchId, defaultPayeeId, existingExpense, onBusyChange, onCommitted, onClose }: Props) {
  const [branchId, setBranchId] = useState(defaultBranchId || branches[0]?.id || "");
  const [payeeId, setPayeeId] = useState(defaultPayeeId || "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OperatingCfdiPreview | null>(null);
  const [category, setCategory] = useState("SERVICIOS");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OperatingCfdiConfirmation | null>(null);
  const inFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  const payee = payees.find(item => item.id === payeeId);
  const sameAmount = !existingExpense || preview?.totalCents === existingExpense.amountCents;
  const compatible = !!preview && !!payee?.taxId && rfc(payee.taxId) === rfc(preview.emitter.rfc) && sameAmount;

  async function submit(confirm: boolean) {
    if (inFlight.current || !file || !branchId || (confirm && (!preview || !compatible))) return;
    inFlight.current = true;
    setBusy(true); onBusyChange(true); setError("");
    if (!confirm) setPreview(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const form = new FormData();
      form.append("file", file);
      if (confirm) form.append("data", JSON.stringify(existingExpense
        ? { mode: "ASSOCIATE", branchId, payeeId, expenseId: existingExpense.id }
        : { mode: "CREATE", branchId, payeeId, category, description: description.trim(),
          ...(costCenterId ? { costCenterId } : {}), ...(dueDate ? { dueDate } : {}) }));
      else form.append("branchId", branchId);
      const response = await fetch(`/api/finance/expense-invoices/${confirm ? "confirm" : "preview"}`, { method: "POST", body: form, signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(mensajeDeError(body, "No se pudo procesar el CFDI. Inténtalo de nuevo."));
      if (confirm) { setResult(body.data); onCommitted(); }
      else setPreview(body.data);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo conectar. Inténtalo de nuevo.");
    } finally {
      if (!controller.signal.aborted) { setBusy(false); onBusyChange(false); }
      inFlight.current = false;
    }
  }

  if (result) return <div className="space-y-4">
    <p role="status" className="rounded-md bg-muted p-3 text-sm">{result.outcome === "EXISTING"
      ? "Este CFDI ya estaba registrado. No se creó otro gasto; abre el gasto existente para consultar su estado."
      : existingExpense ? "Factura vinculada al gasto existente. Se conserva su importe y estado; sigue siendo una sola obligación de pago."
      : "Gasto con CFDI registrado, pendiente de aprobación. La carga no autoriza ni paga el gasto."}</p>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" asChild><a href={`/dashboard/finance/expenses?focus=${encodeURIComponent(result.expenseId)}`}>Abrir gasto</a></Button>
      <Button type="button" onClick={onClose}>Listo</Button>
    </div>
  </div>;

  return <form className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); void submit(true); }} aria-busy={busy}>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <div className="space-y-2"><Label htmlFor="cfdi-branch">Sucursal del gasto</Label>
        <select id="cfdi-branch" className={selectClass} value={branchId} disabled={!!existingExpense} required onChange={event => { setBranchId(event.target.value); setPreview(null); setError(""); }}>
          <option value="" disabled>Selecciona sucursal</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></div>
      <div className="space-y-2"><Label htmlFor="cfdi-file">Archivo XML del CFDI</Label>
        <Input id="cfdi-file" type="file" accept=".xml,application/xml,text/xml" required onChange={event => {
          const selected = event.target.files?.[0] || null;
          setPreview(null); setError("");
          if (selected && (selected.size > 1024 * 1024 || !selected.name.toLowerCase().endsWith(".xml"))) {
            setFile(null); setError("Selecciona un archivo XML de hasta 1 MiB.");
          } else setFile(selected);
        }} />
        <p className="text-xs text-muted-foreground">CFDI 4.0 en MXN, hasta 1 MiB. IVA, exento o tasa cero; retenciones y otros tratamientos requieren revisión.</p>
        <Button type="button" variant="outline" disabled={!file || !branchId || busy} onClick={() => void submit(false)}>Ver vista previa</Button>
      </div>
      {preview && <>
        <dl aria-label="Datos fiscales del CFDI" className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-muted p-3 text-sm">
          {[["Emisor", `${preview.emitter.name} · ${preview.emitter.rfc}`], ["Receptor", `${preview.receiver.name} · ${preview.receiver.rfc}`],
            ["UUID", preview.uuid], ["Fecha del CFDI", preview.fecha.replace("T", " ")], ["Moneda", preview.currency],
            ["Subtotal", money(preview.subtotalCents)], ["IVA", money(preview.taxCents)], ["Retenciones", money(preview.withheldTaxCents)],
            ["Total", money(preview.totalCents)]].map(([label, value], index) => <div key={label} className={index < 3 ? "col-span-2 min-w-0" : "min-w-0"}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words font-medium tabular-nums">{value}</dd></div>)}
        </dl>
        <div className="space-y-2"><Label htmlFor="cfdi-payee">Contraparte del gasto</Label>
          <select id="cfdi-payee" className={selectClass} value={payeeId} required disabled={!!defaultPayeeId} onChange={event => setPayeeId(event.target.value)}>
            <option value="">Selecciona la contraparte</option>{payees.map(item => <option key={item.id} value={item.id}>{item.name} · {item.taxId || "Sin RFC"}</option>)}
          </select>
          {(!payee?.taxId || rfc(payee.taxId) !== rfc(preview.emitter.rfc)) && <p role="alert" className="text-sm text-destructive">Selecciona una contraparte con el RFC {preview.emitter.rfc}. Si falta, regístrala en Finanzas → Contrapartes y vuelve a cargar el XML.</p>}
          <p className="text-xs text-muted-foreground">La elección es explícita; el RFC debe coincidir con el emisor.</p>
        </div>
        {!sameAmount && existingExpense && <p role="alert" className="text-sm text-destructive">El XML tiene un total de {money(preview.totalCents)} y el gasto de {money(existingExpense.amountCents)}. Deben coincidir; no se ajustará el gasto.</p>}
        {!existingExpense && <><div className="space-y-2"><Label htmlFor="cfdi-category">Categoría del gasto</Label>
          <select id="cfdi-category" className={selectClass} value={category} onChange={event => setCategory(event.target.value)}>
            <option value="RENTA">Renta de inmueble</option><option value="SERVICIOS">Servicios (luz, agua, gas, internet)</option>
            <option value="MANTENIMIENTO">Mantenimiento de equipos</option><option value="PUBLICIDAD">Publicidad</option>
            <option value="SERVICIOS_PROFESIONALES">Servicios profesionales</option><option value="OTROS">Otros gastos</option>
          </select></div>
        <div className="space-y-2"><Label htmlFor="cfdi-description">Descripción del gasto</Label>
          <Input id="cfdi-description" required maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="cfdi-cost-center">Centro de costo del gasto (opcional)</Label>
          <select id="cfdi-cost-center" className={selectClass} value={costCenterId} onChange={event => setCostCenterId(event.target.value)}>
            <option value="">Sin centro de costo</option>{costCenters.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
          </select></div>
        <div className="space-y-2"><Label htmlFor="cfdi-due">Vencimiento (opcional)</Label>
          <Input id="cfdi-due" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></div>
        <p className="text-xs text-muted-foreground">Importe e impuestos vienen del XML. La fecha de operación será la del CFDI. El gasto requiere aprobación.</p></>}
        {existingExpense && <p className="text-xs text-muted-foreground">La asociación no cambia el importe, la fecha de operación ni la aprobación del gasto. El servidor comprueba pagos, pólizas y periodos antes de guardar.</p>}
      </>}
    </fieldset>
    {busy && <p role="status" className="text-sm">{preview ? "Confirmando gasto…" : "Validando XML…"}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
      {preview && <Button type="submit" disabled={busy || !compatible || (!existingExpense && !description.trim())}>{existingExpense ? "Confirmar factura del gasto" : "Confirmar gasto con CFDI"}</Button>}
    </div>
  </form>;
}
