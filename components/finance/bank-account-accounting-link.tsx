"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { readAccountingPreparation } from "@/lib/services/accounting/account-service";
import { ledgerRequest, ledgerToday } from "./accounting-types";

type Preparation = Awaited<ReturnType<typeof readAccountingPreparation>>;
type Account = Preparation["accounts"][number];
type Bank = { id: string; label: string; accountLastFour: string; currency: string;
  purpose: "DISPERSION" | "RECEPCION" | "MIXTO" };
const control = "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const usable = (account: Account) => account.kind === "ASSET" && account.active && account.postable
  && account.validFrom <= ledgerToday() && (!account.validTo || account.validTo >= ledgerToday());

/** Uses the same mapping as accounting preparation; the bank purpose is never rewritten. */
export function BankAccountAccountingLink({ bank }: { bank: Bank }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <DialogTrigger asChild><Button variant="outline" size="sm" aria-label={`Cuenta contable de ${bank.label}`}>
      Cuenta contable
    </Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>Cuenta contable del banco</DialogTitle>
        <DialogDescription>{bank.label} · {bank.accountLastFour} · {bank.currency}</DialogDescription>
      </DialogHeader>
      {open && <BankLinkForm bank={bank} onBusyChange={setBusy} />}
      <DialogFooter><DialogClose asChild><Button variant="outline" disabled={busy}>Cerrar</Button></DialogClose></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function BankLinkForm({ bank, onBusyChange }: { bank: Bank; onBusyChange: (busy: boolean) => void }) {
  const [data, setData] = useState<Preparation | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    void ledgerRequest<Preparation>("/api/finance/accounting/preparation", { signal: controller.signal })
      .then(preparation => {
        if (controller.signal.aborted) return;
        if (!preparation.banks.some(row => row.id === bank.id)) {
          throw new Error("La cuenta bancaria ya no está activa o disponible. Actualiza el catálogo de bancos.");
        }
        setData(preparation);
        setSelected(preparation.links.find(link => link.bankAccountId === bank.id)?.accountId ?? "");
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [bank.id, refresh]);

  const currentId = data?.links.find(link => link.bankAccountId === bank.id)?.accountId;
  const current = data?.accounts.find(account => account.id === currentId);
  const options = data?.accounts.filter(account => usable(account) || account.id === currentId) ?? [];
  const eligible = data?.accounts.some(account => account.id === selected && usable(account));
  const allowed = bank.currency === "MXN" && !!data && !data.truncated;
  function working(value: boolean) { setBusy(value); onBusyChange(value); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!allowed || !eligible || busy) return;
    working(true); setError(""); setNotice("");
    try {
      await ledgerRequest("/api/finance/accounting/preparation", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link", input: { bankAccountId: bank.id, accountId: selected } }) });
      setData(previous => previous && ({ ...previous, links: [
        ...previous.links.filter(link => link.bankAccountId !== bank.id),
        { accountId: selected, bankAccountId: bank.id, costCenterId: null },
      ] }));
      setNotice("Vínculo guardado. Preparar contabilidad utilizará esta misma cuenta.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el vínculo."); }
    finally { working(false); }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed || busy) return;
    const fields = new FormData(event.currentTarget);
    working(true); setError(""); setNotice("");
    try {
      const account = await ledgerRequest<Account>("/api/finance/accounting/preparation", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "account", input: {
          code: fields.get("code"), name: fields.get("name"), validFrom: fields.get("validFrom"),
          kind: "ASSET", normalBalance: "DEBIT", active: true, postable: true,
        } }) });
      setData(previous => previous && ({ ...previous, accounts: [...previous.accounts, account] }));
      setSelected(account.id); setCreating(false);
      setNotice("Cuenta contable creada. Guarda el vínculo para asociarla con este banco.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear la cuenta contable."); }
    finally { working(false); }
  }

  return <div className="min-w-0 space-y-4">
    <p className="text-sm text-muted-foreground">{bank.purpose === "MIXTO"
      ? "Pagos e ingresos usan la misma cuenta contable."
      : bank.purpose === "DISPERSION" ? "Los pagos de este banco usarán la cuenta contable vinculada."
        : "Los ingresos de este banco usarán la cuenta contable vinculada."}</p>
    {loading && <p role="status" className="text-sm text-muted-foreground">Consultando el vínculo contable…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!loading && !data && <Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Volver a consultar</Button>}
    {data?.truncated && <p role="alert" className="text-sm">El catálogo está incompleto. Revisa la preparación contable antes de vincular este banco.</p>}
    {data && !data.truncated && <>
      <p className="text-sm">{current ? `Vinculada a ${current.code} · ${current.name}`
        : currentId ? "La cuenta vinculada requiere revisión en el catálogo contable." : "Este banco todavía no tiene una cuenta contable vinculada."}
        {current && !usable(current) && " · requiere revisión"}</p>
      {bank.currency !== "MXN" && <p role="alert" className="text-sm">El vínculo contable requiere una cuenta bancaria en MXN.</p>}
      {!options.some(usable) && <p className="text-sm text-muted-foreground">Aún no hay cuentas contables de activo disponibles.</p>}
      <form onSubmit={save} className="space-y-3" aria-label="Vincular banco con contabilidad">
        <div className="grid gap-1 text-sm"><label htmlFor={`bank-ledger-${bank.id}`}>Cuenta contable</label>
          <select id={`bank-ledger-${bank.id}`} className={control} value={selected} onChange={event => setSelected(event.target.value)}
            disabled={busy || !allowed || creating} required>
            <option value="">Selecciona una cuenta</option>
            {options.map(account => <option key={account.id} value={account.id} disabled={!usable(account)}>
              {account.code} · {account.name}{!usable(account) ? " · requiere revisión" : ""}
            </option>)}
          </select>
        </div>
        <Button type="submit" disabled={busy || !allowed || !eligible || selected === currentId || creating}>
          {busy ? "Guardando…" : "Guardar vínculo"}</Button>
      </form>
      {!creating && <Button variant="outline" disabled={busy || !allowed} onClick={() => { setCreating(true); setNotice(""); setError(""); }}>
        Añadir cuenta contable</Button>}
      {creating && <form onSubmit={create} className="space-y-3 border-t pt-4" aria-label="Crear cuenta contable del banco">
        <p className="text-sm text-muted-foreground">Se añadirá al catálogo como activo, con saldo deudor. Usa el código y nombre de tu catálogo contable.</p>
        <label className="grid gap-1 text-sm">Código contable<Input name="code" maxLength={32} required disabled={busy} /></label>
        <label className="grid gap-1 text-sm">Nombre contable<Input name="name" maxLength={160} defaultValue={bank.label} required disabled={busy} /></label>
        <label className="grid gap-1 text-sm">Vigente desde<input className={control} name="validFrom" type="date" defaultValue={ledgerToday()} max={ledgerToday()} required disabled={busy} /></label>
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{busy ? "Creando…" : "Crear cuenta contable"}</Button>
          <Button variant="ghost" type="button" disabled={busy} onClick={() => setCreating(false)}>Cancelar creación</Button></div>
      </form>}
    </>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
