"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ledgerRequest, ledgerToday, type LedgerAccount } from "./accounting-types";

const control = "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const salesRoles = [
  ["CASH", "Efectivo en caja"], ["CARD_RECEIVABLE", "Cobros de tarjeta por recibir"],
  ["PLATFORM_RECEIVABLE", "Cobros de plataformas por recibir"], ["OTHER_RECEIVABLE", "Otros cobros por recibir"],
  ["SALES_REVENUE", "Ingresos por ventas"], ["SALES_TAX", "Impuesto documentado de ventas"], ["TIPS_PAYABLE", "Propinas por entregar"],
];
export const accountingOperations = [
  { event: "EXPENSE_RECOGNIZED", label: "Reconocer un gasto aprobado", help: "La partida determina la cuenta del gasto o activo. Aquí defines la obligación por pagar y el impuesto documentado.",
    roles: [["PAYABLE", "Obligaciones por pagar"], ["RECOVERABLE_TAX", "Impuesto recuperable documentado"], ["EXPENSE", "Gastos sin partida (cuenta general)"]] },
  { event: "EXPENSE_PAYMENT", label: "Confirmar el pago de un gasto", help: "La corrida usa la cuenta vinculada a su banco. La cuenta general solo se utiliza en pagos manuales.",
    roles: [["PAYABLE", "Obligaciones por pagar"], ["PAYMENT_SOURCE", "Salida de pagos manuales (cuenta general)"]] },
  { event: "SALE_RECOGNIZED", label: "Registrar una venta del corte", help: "Separa efectivo, cobros por recibir, ingreso, impuesto y propinas según el desglose documentado del corte.", roles: salesRoles },
  { event: "SALE_REFUNDED", label: "Registrar una devolución vinculada", help: "Utiliza las mismas cuentas de la venta original. La devolución requiere su referencia y desglose.", roles: salesRoles },
];
export interface RulePreview {
  rule: { id: string; code: string; name: string; version: number; effectiveFrom: string; active: boolean } | null;
  entries: { role: string; accountId: string; accountName: string; costCenterId?: string | null; required?: boolean }[];
  blockers: { reason: string }[];
}

export function GuidedAccountingRules({ accounts, onDone }: { accounts: LedgerAccount[]; onDone: () => void }) {
  const [eventType, setEventType] = useState(accountingOperations[0].event);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [previous, setPrevious] = useState<RulePreview["rule"]>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [date, setDate] = useState(ledgerToday());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(true);
  const operation = accountingOperations.find(item => item.event === eventType)!;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        // Resolve the predecessor including scheduled versions, without scanning history.
        const [current, detail] = await Promise.all([ledgerToday(), "9999-12-31"].map(date => ledgerRequest<RulePreview>(
          `/api/finance/accounting/settings?view=preview&eventType=${eventType}&date=${date}`, { signal: controller.signal })));
        const latest = detail.rule;
        if (controller.signal.aborted) return;
        setPrevious(latest); setPreview(current);
        setMapping(Object.fromEntries(detail.entries.map(entry => [entry.role, entry.accountId])));
        setActive(latest?.active ?? true);
        const tomorrow = latest ? new Date(`${latest.effectiveFrom}T00:00:00Z`) : null;
        if (tomorrow) tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        setDate(latest && latest.effectiveFrom >= ledgerToday() ? tomorrow!.toISOString().slice(0, 10) : ledgerToday());
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo consultar la configuración."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [eventType, refresh]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (previous && date <= previous.effectiveFrom) throw new Error(`El cambio debe iniciar después del ${previous.effectiveFrom}.`);
      const detail = previous ? await ledgerRequest<RulePreview>(`/api/finance/accounting/settings?view=rule&id=${previous.id}`) : null;
      // Preserve custom roles/centers configured through older administrative tools.
      const entries = new Map((detail?.entries ?? []).map(entry => [entry.role, entry]));
      for (const [role] of operation.roles) {
        if (mapping[role]) entries.set(role, { ...entries.get(role), role, accountId: mapping[role],
          accountName: "", required: !["EXPENSE", "PAYMENT_SOURCE", "RECOVERABLE_TAX"].includes(role) });
        else entries.delete(role);
      }
      await ledgerRequest("/api/finance/accounting/settings", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: previous?.code ?? eventType, name: operation.label, eventType, effectiveFrom: date,
          supersedesId: previous?.id ?? null, active,
          entries: [...entries.values()].map(({ role, accountId, costCenterId, required }) => ({ role, accountId, costCenterId, required })) }) });
      setNotice(active ? `Configuración guardada desde ${date}. Las pólizas publicadas conservan sus cuentas.`
        : `Contabilización de esta operación suspendida desde ${date}. Sus hechos quedarán pendientes de revisión.`);
      setEditing(false); setLoading(true); setRefresh(value => value + 1); onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la configuración."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="operations-heading" className="space-y-4 border-t pt-6">
    <div><h2 id="operations-heading" className="text-xl font-semibold">Cuentas para cada operación</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">El responsable contable revisa esta configuración. Los gastos y pagos se siguen registrando en sus pantallas habituales.</p></div>
    <div className="grid max-w-xl gap-1 text-sm"><label htmlFor="accounting-operation">Operación</label>
      <select id="accounting-operation" className={control} value={eventType} disabled={busy} onChange={e => {
        setEventType(e.target.value); setLoading(true); setError(""); setNotice(""); setEditing(false); setPreview(null);
      }}>{accountingOperations.map(item => <option key={item.event} value={item.event}>{item.label}</option>)}</select>
    </div>
    <p className="max-w-prose text-sm text-muted-foreground">{operation.help}</p>
    {error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{error}</p>
      {!busy && <Button variant="outline" onClick={() => { setError(""); setLoading(true); setRefresh(value => value + 1); }}>Volver a consultar configuración</Button>}</div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">Consultando cuentas de la operación…</p>
      : preview && <div className="space-y-3">
        <p className="text-sm">{preview.rule ? `Configuración vigente desde ${preview.rule.effectiveFrom}.` : "Esta operación todavía no tiene configuración vigente."}</p>
        {previous && previous.effectiveFrom > ledgerToday() && <p className="text-sm">Hay un cambio programado para {previous.effectiveFrom}. El siguiente cambio deberá ser posterior.</p>}
        {preview.entries.length > 0 && <dl className="max-w-3xl divide-y text-sm">{preview.entries.map(entry => <div key={entry.role} className="grid gap-1 py-2 sm:grid-cols-2">
          <dt>{operation.roles.find(([role]) => role === entry.role)?.[1] ?? "Cuenta adicional configurada"}</dt><dd>{entry.accountName}</dd>
        </div>)}</dl>}
        {preview.blockers.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">{preview.blockers.map((item, index) => <li key={index}>
          {item.reason.replaceAll(eventType, operation.label)}</li>)}</ul>}
        <Button variant="outline" disabled={accounts.length === 0} onClick={() => setEditing(value => !value)} aria-expanded={editing}>
          {editing ? "Cerrar configuración" : previous ? "Cambiar cuentas de esta operación" : "Configurar esta operación"}</Button>
        {accounts.length === 0 && <p className="text-sm text-muted-foreground">Añade las cuentas del catálogo contable para poder elegirlas aquí.</p>}
      </div>}
    {editing && !loading && <form onSubmit={submit} aria-label="Configurar operación" className="max-w-3xl space-y-4 bg-muted/40 p-4">
      {operation.roles.map(([role, label]) => <div key={role} className="grid gap-1 text-sm">
        <label htmlFor={`operation-${role}`}>{label}</label>
        <select id={`operation-${role}`} className={control} value={mapping[role] ?? ""} required={role === "PAYABLE" || role === "SALES_REVENUE"}
          onChange={e => setMapping(value => ({ ...value, [role]: e.target.value }))}>
          <option value="">{role === "EXPENSE" ? "Exigir partida vinculada" : role === "PAYMENT_SOURCE" ? "Usar solo bancos vinculados de tesorería" : "Sin cuenta asignada"}</option>
          {accounts.filter(account => account.active && account.postable).map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
        </select></div>)}
      <p className="text-sm text-muted-foreground">Si una operación contiene impuesto u otro componente sin cuenta asignada, quedará pendiente para revisión.</p>
      <label className="grid max-w-xs gap-1 text-sm">Aplicar desde
        <input className={control} type="date" value={date} onChange={e => setDate(e.target.value)} required/></label>
      {previous && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={active} onChange={e => setActive(e.target.checked)}/>
        Mantener habilitada la contabilización de esta operación desde esa fecha. Al suspenderla, los gastos y pagos operativos continúan y sus hechos contables quedan pendientes.</label>}
      <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar configuración de la operación"}</Button>
    </form>}
  </section>;
}
