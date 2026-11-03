"use client";

import { useEffect, useState } from "react";
import { AccountingPreparation } from "./accounting-preparation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toCents } from "@/lib/services/accounting/amounts";
import { ledgerMoney, ledgerRequest, ledgerToday, type LedgerAccount } from "./accounting-types";

type Opening = { opening: { id: string; openingDate: string; memo: string | null };
  documents: { id: string; label: string; reference: string; amountCents: number | null }[];
  journal: { id: string; number: number | null; status: string; accountingDate: string; postingReason: string | null } | null;
  lines: { id: string; accountId: string; debitCents: number; creditCents: number; memo: string | null }[];
  totals: { debitCents: number; creditCents: number; balanced: boolean } };

type Line = { accountId: string; side: "DEBIT" | "CREDIT"; amount: string; memo: string };
type Document = { label: string; reference: string; amount: string };
const control = "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const emptyLine = (side: Line["side"]): Line => ({ accountId: "", side, amount: "", memo: "" });

export function AccountingSettings() {
  return <AccountingPreparation renderOpening={(accounts, onDone, onError, canPublish) =>
    <OpeningSection accounts={accounts}
      onDone={onDone} onError={onError} canPublish={canPublish}/>}/>;
}
function OpeningSection({ accounts, onDone, onError, canPublish }: {
  accounts: LedgerAccount[];
  onDone: (message: string) => void; onError: (message: string) => void;
  canPublish: boolean;
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
          {!canPublish && <p className="text-sm text-muted-foreground">La publicación requiere un usuario con autorización contable de empresa.</p>}
          <Button type="submit" disabled={busy || !canPublish}>{busy ? "Publicando…" : "Publicar apertura"}</Button>
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
