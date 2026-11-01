"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toCents } from "@/lib/services/accounting/amounts";
import { ledgerMoney, ledgerRequest, ledgerToday, type LedgerAccount } from "./accounting-types";

type RuleRow = { id: string; code: string; name: string; eventType: string; version: number;
  effectiveFrom: string; supersedesId: string | null; active: boolean; notes: string | null };
type RuleEntry = { role: string; required: boolean; accountId: string; accountCode: string;
  accountName: string; accountActive: boolean; accountPostable: boolean;
  accountValidFrom: string; accountValidTo: string | null };
type RuleDetail = { rule: RuleRow; entries: RuleEntry[] };
type Preview = { eventType: string; date: string; rule: RuleRow | null; entries: RuleEntry[];
  blockers: { code: string; role?: string; reason: string }[] };
type Opening = { opening: { id: string; openingDate: string; memo: string | null };
  documents: { id: string; label: string; reference: string; amountCents: number | null }[];
  journal: { id: string; number: number | null; status: string; accountingDate: string; postingReason: string | null } | null;
  lines: { id: string; accountId: string; debitCents: number; creditCents: number; memo: string | null }[];
  totals: { debitCents: number; creditCents: number; balanced: boolean } };

type Line = { accountId: string; side: "DEBIT" | "CREDIT"; amount: string; memo: string };
type RuleLine = { role: string; accountId: string; required: boolean };
type Document = { label: string; reference: string; amount: string };
const control = "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const emptyLine = (side: Line["side"]): Line => ({ accountId: "", side, amount: "", memo: "" });

export function AccountingSettings() {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [accountPage, setAccountPage] = useState(1);
  const [accountMore, setAccountMore] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadAccounts = useCallback(async (page: number) => {
    const data = await ledgerRequest<{ items: LedgerAccount[]; hasMore: boolean }>(
      `/api/finance/accounting/accounts?page=${page}`);
    setAccounts(previous => page === 1 ? data.items : [...previous, ...data.items]);
    setAccountMore(data.hasMore);
  }, []);

  useEffect(() => {
    void (async () => {
      try { await loadAccounts(1); }
      catch (e) { setError(e instanceof Error ? e.message : "No se pudieron consultar las cuentas."); }
    })();
  }, [loadAccounts]);

  return <div className="container mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
    <div>
      <Link href="/dashboard/finance/control-interno" className="text-sm text-muted-foreground underline underline-offset-4">
        Volver a Cierre y control
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Contabilidad</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Fija la apertura de la empresa y las reglas que traducen cada hecho en cuentas.
        Una regla publicada no se edita: se revisa con una nueva versión y su fecha efectiva.
      </p>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <OpeningSection accounts={accounts} accountMore={accountMore} onLoadMore={() => {
      const next = accountPage + 1; setAccountPage(next); loadAccounts(next).catch(e => setError(e.message));
    }} onDone={message => { setError(""); setNotice(message); }} onError={setError}/>
    <RulesSection accounts={accounts} onDone={message => { setError(""); setNotice(message); }} onError={setError}/>
  </div>;
}

function OpeningSection({ accounts, accountMore, onLoadMore, onDone, onError }: {
  accounts: LedgerAccount[]; accountMore: boolean; onLoadMore: () => void;
  onDone: (message: string) => void; onError: (message: string) => void;
}) {
  const [opening, setOpening] = useState<Opening | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState("");
  const [memo, setMemo] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine("DEBIT"), emptyLine("CREDIT")]);
  const [documents, setDocuments] = useState<Document[]>([{ label: "", reference: "", amount: "" }]);

  useEffect(() => {
    const controller = new AbortController();
    ledgerRequest<Opening | null>("/api/finance/accounting/openings", { signal: controller.signal })
      .then(data => { setOpening(data); setDate(data?.opening.openingDate ?? ledgerToday()); })
      .catch(e => { if (!controller.signal.aborted) onError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [onError]);

  const change = (index: number, patch: Partial<Line>) =>
    setLines(previous => previous.map((line, i) => i === index ? { ...line, ...patch } : line));
  let debit = 0, credit = 0;
  try {
    for (const line of lines) {
      const amount = line.amount ? toCents(line.amount) : 0;
      if (line.side === "DEBIT") debit += amount; else credit += amount;
    }
  } catch { /* The submit shows the exact validation error. */ }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); onError(""); setBusy(true);
    try {
      if (debit !== credit) throw new Error(`La apertura debe cuadrar: cargos ${ledgerMoney(debit)} y abonos ${ledgerMoney(credit)}.`);
      const payload = {
        openingDate: date, memo: memo || null, reason,
        lines: lines.map(line => ({ accountId: line.accountId, memo: line.memo || null,
          debitCents: line.side === "DEBIT" ? toCents(line.amount) : 0,
          creditCents: line.side === "CREDIT" ? toCents(line.amount) : 0 })),
        documents: documents.map(document => ({ label: document.label, reference: document.reference,
          amountCents: document.amount ? toCents(document.amount) : null })),
      };
      const created = await ledgerRequest<Opening>("/api/finance/accounting/openings", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setOpening(created);
      onDone("Apertura publicada. Los documentos quedan vinculados al primer asiento.");
    } catch (e) { onError(e instanceof Error ? e.message : "No se pudo publicar la apertura."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="opening-heading" className="space-y-4 border-t pt-6">
    <div>
      <h2 id="opening-heading" className="text-xl font-semibold">Apertura</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Una sola apertura por empresa. Fija la fecha de arranque, el asiento balanceado y los
        documentos revisados; no puede convivir con pólizas anteriores o del mismo día.
      </p>
    </div>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Consultando la apertura…</p>
      : opening ? <OpeningSummary opening={opening}/>
      : <form onSubmit={submit} className="space-y-5" aria-label="Capturar apertura">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">Fecha contable
            <input type="date" className={control} value={date} onChange={e => setDate(e.target.value)} required/>
          </label>
          <label className="grid gap-1 text-sm">Motivo de publicación
            <input className={control} value={reason} minLength={5} maxLength={500} required
              onChange={e => setReason(e.target.value)} placeholder="Acta o revisión que respalda la apertura"/>
          </label>
        </div>
        <label className="grid gap-1 text-sm">Nota <span className="text-muted-foreground">(opcional)</span>
          <input className={control} value={memo} maxLength={500} onChange={e => setMemo(e.target.value)}/>
        </label>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Renglones</legend>
          {lines.map((line, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_8rem_9rem_auto]">
            <label className="sr-only" htmlFor={`opening-account-${index}`}>Cuenta</label>
            <select id={`opening-account-${index}`} className={control} value={line.accountId}
              onChange={e => change(index, { accountId: e.target.value })} required>
              <option value="">Selecciona una cuenta</option>
              {accounts.filter(a => a.postable).map(account => <option key={account.id} value={account.id}>
                {account.code} · {account.name}{account.active ? "" : " (inactiva)"}
              </option>)}
            </select>
            <label className="sr-only" htmlFor={`opening-side-${index}`}>Lado</label>
            <select id={`opening-side-${index}`} className={control} value={line.side}
              onChange={e => change(index, { side: e.target.value as Line["side"] })}>
              <option value="DEBIT">Cargo</option><option value="CREDIT">Abono</option>
            </select>
            <label className="sr-only" htmlFor={`opening-amount-${index}`}>Importe</label>
            <input id={`opening-amount-${index}`} className={control + " text-right tabular-nums"} inputMode="decimal"
              value={line.amount} onChange={e => change(index, { amount: e.target.value })} required placeholder="0.00"/>
            <Button type="button" variant="ghost" size="sm" disabled={lines.length <= 2}
              onClick={() => setLines(previous => previous.filter((_, i) => i !== index))}>Quitar</Button>
          </div>)}
          <Button type="button" variant="outline" size="sm"
            onClick={() => setLines(previous => [...previous, emptyLine("DEBIT")])}>Añadir renglón</Button>
          {accountMore && <Button type="button" variant="ghost" size="sm" onClick={onLoadMore}>Cargar más cuentas</Button>}
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Documentos de respaldo</legend>
          {documents.map((document, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_9rem_auto]">
            <label className="sr-only" htmlFor={`doc-label-${index}`}>Documento</label>
            <Input id={`doc-label-${index}`} value={document.label} placeholder="Balance, acta, corte…" required
              onChange={e => setDocuments(previous => previous.map((row, i) => i === index ? { ...row, label: e.target.value } : row))}/>
            <label className="sr-only" htmlFor={`doc-ref-${index}`}>Referencia</label>
            <Input id={`doc-ref-${index}`} value={document.reference} placeholder="Folio o ruta" required
              onChange={e => setDocuments(previous => previous.map((row, i) => i === index ? { ...row, reference: e.target.value } : row))}/>
            <label className="sr-only" htmlFor={`doc-amount-${index}`}>Importe</label>
            <Input id={`doc-amount-${index}`} className="text-right tabular-nums" inputMode="decimal"
              value={document.amount} placeholder="Opcional"
              onChange={e => setDocuments(previous => previous.map((row, i) => i === index ? { ...row, amount: e.target.value } : row))}/>
            <Button type="button" variant="ghost" size="sm" disabled={documents.length <= 1}
              onClick={() => setDocuments(previous => previous.filter((_, i) => i !== index))}>Quitar</Button>
          </div>)}
          <Button type="button" variant="outline" size="sm"
            onClick={() => setDocuments(previous => [...previous, { label: "", reference: "", amount: "" }])}>Añadir documento</Button>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p role="status" className="text-sm tabular-nums text-muted-foreground">
            Cargos {ledgerMoney(debit)} · Abonos {ledgerMoney(credit)} · Diferencia {ledgerMoney(debit - credit)}
          </p>
          <Button type="submit" disabled={busy}>{busy ? "Publicando…" : "Publicar apertura"}</Button>
        </div>
      </form>}
  </section>;
}

function OpeningSummary({ opening }: { opening: Opening }) {
  return <div className="space-y-4">
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Fecha</dt>
        <dd className="tabular-nums">{opening.opening.openingDate}</dd></div>
      <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Póliza</dt>
        <dd className="tabular-nums">{opening.journal ? `#${opening.journal.number ?? "—"}` : "Sin póliza"}</dd></div>
      <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Motivo</dt>
        <dd>{opening.journal?.postingReason ?? "—"}</dd></div>
    </dl>
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">Documentos que respaldan la apertura</caption>
        <thead className="bg-muted/50 text-left"><tr>
          <th scope="col" className="px-3 py-2 font-medium">Documento</th>
          <th scope="col" className="px-3 py-2 font-medium">Referencia</th>
          <th scope="col" className="px-3 py-2 text-right font-medium">Importe</th>
        </tr></thead>
        <tbody>{opening.documents.map(document => <tr key={document.id} className="border-t">
          <td className="px-3 py-2">{document.label}</td>
          <td className="px-3 py-2 text-muted-foreground">{document.reference}</td>
          <td className="px-3 py-2 text-right tabular-nums">
            {document.amountCents === null ? "—" : ledgerMoney(document.amountCents)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="text-sm text-muted-foreground">
      Cargos {ledgerMoney(opening.totals.debitCents)} · Abonos {ledgerMoney(opening.totals.creditCents)}.
      La apertura no se edita: una corrección se registra con una reversa.
    </p>
  </div>;
}

function RulesSection({ accounts, onDone, onError }: {
  accounts: LedgerAccount[]; onDone: (message: string) => void; onError: (message: string) => void;
}) {
  const [list, setList] = useState<{ items: RuleRow[]; hasMore: boolean; key: string; failed: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState<RuleDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewEvent, setPreviewEvent] = useState("");
  const [previewDate, setPreviewDate] = useState(ledgerToday());
  const listKey = `${page}|${eventType}|${refresh}`;
  const loading = list?.key !== listKey;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page) });
    if (eventType) query.set("eventType", eventType);
    ledgerRequest<{ items: RuleRow[]; hasMore: boolean }>(`/api/finance/accounting/settings?${query}`,
      { signal: controller.signal })
      .then(data => setList({ items: data.items, hasMore: data.hasMore, key: listKey, failed: false }))
      .catch(e => {
        if (controller.signal.aborted) return;
        onError(e instanceof Error ? e.message : "No se pudieron consultar las reglas.");
        setList(previous => ({ items: previous?.items ?? [], hasMore: false, key: listKey, failed: true }));
      });
    return () => controller.abort();
  }, [page, eventType, refresh, listKey, onError]);

  async function openDetail(id: string) {
    onError("");
    try { setDetail(await ledgerRequest<RuleDetail>(`/api/finance/accounting/settings?view=rule&id=${id}`)); }
    catch (e) { onError(e instanceof Error ? e.message : "No se pudo abrir la regla."); }
  }
  async function runPreview(event: React.FormEvent) {
    event.preventDefault(); onError(""); setPreview(null);
    try {
      const query = new URLSearchParams({ view: "preview", eventType: previewEvent, date: previewDate });
      setPreview(await ledgerRequest<Preview>(`/api/finance/accounting/settings?${query}`));
    } catch (e) { onError(e instanceof Error ? e.message : "No se pudo consultar la vista previa."); }
  }

  return <section aria-labelledby="rules-heading" className="space-y-4 border-t pt-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="rules-heading" className="text-xl font-semibold">Reglas de reconocimiento</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Cada hecho usa la última versión vigente a su fecha. La póliza congela la versión aplicada,
          y publicar sin regla o sin cuenta vigente queda bloqueado con el motivo a la vista.
        </p>
      </div>
      <Button size="sm" onClick={() => { setCreating(value => !value); setDetail(null); }}>
        {creating ? "Cerrar captura" : "Nueva regla"}
      </Button>
    </div>
    <form onSubmit={runPreview} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
      <label className="sr-only" htmlFor="preview-event">Hecho</label>
      <Input id="preview-event" value={previewEvent} onChange={e => setPreviewEvent(e.target.value.toUpperCase())}
        placeholder="Hecho: EXPENSE_RECOGNIZED" required/>
      <label className="sr-only" htmlFor="preview-date">Fecha contable</label>
      <Input id="preview-date" type="date" value={previewDate} onChange={e => setPreviewDate(e.target.value)} required/>
      <Button type="submit" variant="outline">Vista previa</Button>
    </form>
    {preview && <div role="status" className="rounded-md border p-3 text-sm">
      {preview.rule ? <p>Regla <strong>{preview.rule.code}</strong> versión {preview.rule.version} vigente desde {preview.rule.effectiveFrom}.</p>
        : <p>Sin regla vigente para {preview.eventType} el {preview.date}.</p>}
      {preview.blockers.length > 0 && <ul className="mt-2 list-disc pl-5 text-destructive">
        {preview.blockers.map((blocker, index) => <li key={index}>{blocker.reason}</li>)}
      </ul>}
      {preview.rule && preview.blockers.length === 0 && <p className="mt-2 text-muted-foreground">
        {preview.entries.length} cuenta(s) configurada(s); ninguna bloquea la publicación en esa fecha.
      </p>}
    </div>}
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm">Hecho
        <Input value={eventType} onChange={e => { setEventType(e.target.value.toUpperCase()); setPage(1); }}
          placeholder="Todos" className="w-56"/>
      </label>
      {list && !loading && list.hasMore && <Button variant="ghost" size="sm" onClick={() => setPage(value => value + 1)}>Siguiente página</Button>}
      {page > 1 && <Button variant="ghost" size="sm" onClick={() => setPage(value => value - 1)}>Página anterior</Button>}
      <span className="text-xs text-muted-foreground tabular-nums">Página {page}</span>
    </div>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Consultando reglas…</p>
      : list?.failed
        ? <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">No se pudieron consultar las reglas.</p>
          <Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>Volver a consultar</Button>
        </div>
        : !list || list.items.length === 0
        ? <p className="text-sm text-muted-foreground">Aún no hay reglas configuradas. Sin ellas no se puede publicar un hecho automático.</p>
        : <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Versiones de reglas con su hecho, vigencia y estado</caption>
            <thead className="bg-muted/50 text-left"><tr>
              <th scope="col" className="px-3 py-2 font-medium">Hecho</th>
              <th scope="col" className="px-3 py-2 font-medium">Regla</th>
              <th scope="col" className="px-3 py-2 font-medium">Versión</th>
              <th scope="col" className="px-3 py-2 font-medium">Vigente desde</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Acción</th>
            </tr></thead>
            <tbody>{list.items.map(rule => <tr key={rule.id} className="border-t">
              <td className="px-3 py-2">{rule.eventType}</td>
              <td className="px-3 py-2"><span className="font-medium">{rule.code}</span>
                <span className="block text-xs text-muted-foreground">{rule.name}</span></td>
              <td className="px-3 py-2 tabular-nums">{rule.version}</td>
              <td className="px-3 py-2 tabular-nums">{rule.effectiveFrom}</td>
              <td className="px-3 py-2">{rule.active ? "Activa" : "Retirada"}</td>
              <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => openDetail(rule.id)}>Ver cuentas</Button></td>
            </tr>)}</tbody>
          </table>
        </div>}
    {detail && <div className="rounded-md border p-4 text-sm">
      <p className="font-medium">{detail.rule.code} · versión {detail.rule.version}</p>
      <ul className="mt-2 space-y-1">
        {detail.entries.map(entry => <li key={entry.role} className="flex flex-wrap justify-between gap-2">
          <span>{entry.role}{entry.required ? "" : " (opcional)"}</span>
          <span className="tabular-nums text-muted-foreground">
            {entry.accountCode} · {entry.accountName}
            {entry.accountActive ? "" : " · inactiva"}{entry.accountPostable ? "" : " · acumulativa"}
          </span>
        </li>)}
      </ul>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setDetail(null)}>Cerrar detalle</Button>
    </div>}
    {creating && <RuleForm accounts={accounts} onClose={() => setCreating(false)} onError={onError}
      onDone={message => { setCreating(false); setPage(1); setRefresh(value => value + 1); onDone(message); }}/>}
  </section>;
}

function RuleForm({ accounts, onClose, onDone, onError }: {
  accounts: LedgerAccount[]; onClose: () => void; onDone: (message: string) => void; onError: (message: string) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(ledgerToday());
  const [previous, setPrevious] = useState("");
  const [active, setActive] = useState(true);
  const [entries, setEntries] = useState<RuleLine[]>([{ role: "", accountId: "", required: true }]);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); onError(""); setBusy(true);
    try {
      await ledgerRequest("/api/finance/accounting/settings", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, eventType, effectiveFrom, active,
          supersedesId: previous || null, entries }) });
      onDone(previous ? "Nueva versión registrada con su fecha efectiva." : "Regla registrada.");
    } catch (e) { onError(e instanceof Error ? e.message : "No se pudo registrar la regla."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="space-y-4 rounded-md border p-4" aria-label="Nueva regla contable">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">Código
        <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="CASH_SALE" required/></label>
      <label className="grid gap-1 text-sm">Nombre
        <Input value={name} onChange={e => setName(e.target.value)} maxLength={160} required/></label>
      <label className="grid gap-1 text-sm">Hecho
        <Input value={eventType} onChange={e => setEventType(e.target.value.toUpperCase())} placeholder="EXPENSE_RECOGNIZED" required/></label>
      <label className="grid gap-1 text-sm">Vigente desde
        <input type="date" className={control} value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} required/></label>
      <label className="grid gap-1 text-sm">Versión anterior <span className="text-muted-foreground">(opcional)</span>
        <Input value={previous} onChange={e => setPrevious(e.target.value)} placeholder="ID de la versión que reemplaza"/></label>
      <label className="flex items-center gap-2 pt-6 text-sm">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}/>
        Activa (desmarca para retirar el hecho a partir de esta fecha)
      </label>
    </div>
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Cuentas por rol</legend>
      {entries.map((entry, index) => <div key={index} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto_auto]">
        <label className="sr-only" htmlFor={`entry-role-${index}`}>Rol</label>
        <Input id={`entry-role-${index}`} value={entry.role} placeholder="CASH" required
          onChange={e => setEntries(previous => previous.map((row, i) => i === index ? { ...row, role: e.target.value.toUpperCase() } : row))}/>
        <label className="sr-only" htmlFor={`entry-account-${index}`}>Cuenta</label>
        <select id={`entry-account-${index}`} className={control} value={entry.accountId} required
          onChange={e => setEntries(previous => previous.map((row, i) => i === index ? { ...row, accountId: e.target.value } : row))}>
          <option value="">Selecciona una cuenta</option>
          {accounts.filter(account => account.postable).map(account => <option key={account.id} value={account.id}>
            {account.code} · {account.name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={entry.required}
            onChange={e => setEntries(previous => previous.map((row, i) => i === index ? { ...row, required: e.target.checked } : row))}/>
          Requerida
        </label>
        <Button type="button" variant="ghost" size="sm" disabled={entries.length <= 1}
          onClick={() => setEntries(previous => previous.filter((_, i) => i !== index))}>Quitar</Button>
      </div>)}
      <Button type="button" variant="outline" size="sm"
        onClick={() => setEntries(previous => [...previous, { role: "", accountId: "", required: true }])}>Añadir cuenta</Button>
    </fieldset>
    <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
      <Button type="submit" disabled={busy}>{busy ? "Registrando…" : "Registrar regla"}</Button>
    </div>
  </form>;
}
