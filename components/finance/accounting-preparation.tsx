"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { readAccountingPreparation } from "@/lib/services/accounting/account-service";
import type { previewExpenseRecognition } from "@/lib/services/accounting/expense-adapter";
import { GuidedAccountingRules, type RulePreview } from "./accounting-guided-rules";
import { ledgerMoney, ledgerRequest, ledgerToday, type LedgerAccount } from "./accounting-types";

type Preparation = Awaited<ReturnType<typeof readAccountingPreparation>>;
type ExpensePreview = Awaited<ReturnType<typeof previewExpenseRecognition>>;
type Account = Preparation["accounts"][number];
const control = "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const usable = (account: Account | undefined, kinds: string[]) => !!account && account.active && account.postable
  && kinds.includes(account.kind) && account.validFrom <= ledgerToday() && (!account.validTo || account.validTo >= ledgerToday());

export function AccountingPreparation({ renderOpening }: {
  renderOpening: (accounts: LedgerAccount[], onDone: (message: string) => void, onError: (message: string) => void, canPublish: boolean) => ReactNode;
}) {
  const [data, setData] = useState<Preparation | null>(null);
  const [checks, setChecks] = useState<RulePreview[]>([]);
  const [openingPublished, setOpeningPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [showOpening, setShowOpening] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      ledgerRequest<Preparation>("/api/finance/accounting/preparation", { signal: controller.signal }),
      ledgerRequest<{ opening: unknown } | null>("/api/finance/accounting/openings", { signal: controller.signal }),
      ...["EXPENSE_RECOGNIZED", "EXPENSE_PAYMENT"].map(eventType => ledgerRequest<RulePreview>(
        `/api/finance/accounting/settings?view=preview&eventType=${eventType}&date=${ledgerToday()}`, { signal: controller.signal })),
    ]).then(([preparation, opening, ...rules]) => {
      if (controller.signal.aborted) return;
      setData(preparation); setOpeningPublished(!!opening); setChecks(rules);
    }).catch(e => {
      if (!controller.signal.aborted) { setData(null); setChecks([]); setError(e.message); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  function reload(message = "") { setNotice(message); setError(""); setLoading(true); setRefresh(value => value + 1); }
  const linked = (source: { id: string }, type: "costCenterId" | "bankAccountId") => data?.accounts.find(account =>
    account.id === data.links.find(link => link[type] === source.id)?.accountId);
  const missingCenters = data?.centers.filter(center => !usable(linked(center, "costCenterId"), ["EXPENSE", "ASSET"])).length ?? 0;
  const missingBanks = data?.banks.filter(bank => bank.currency !== "MXN" || !usable(linked(bank, "bankAccountId"), ["ASSET"])).length ?? 0;
  const operationsReady = checks.length === 2 && checks.every(check => check.rule && check.blockers.length === 0
    && check.entries.some(entry => entry.role === "PAYABLE"));
  const prepared = !!data && !data.truncated && data.accounts.length > 0 && data.centers.length > 0 && data.banks.length > 0
    && !missingCenters && !missingBanks && operationsReady && openingPublished;

  return <div className="container mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
    <header>
      <Link href="/dashboard/finance/control-interno" className="text-sm text-muted-foreground underline underline-offset-4">Volver a Cierre y control</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Preparar contabilidad</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">Conecta tus partidas y bancos con sus cuentas contables. Después, Pulso podrá generar las pólizas desde los gastos aprobados y los pagos confirmados en tesorería.</p>
      <p className="mt-2 max-w-prose text-sm">Esta preparación la revisa el responsable contable. Tu equipo sigue usando Gastos y Pagos, con una sola captura.</p>
    </header>
    <nav aria-label="Preparación contable" className="flex flex-wrap gap-x-5 gap-y-3 border-y py-4 text-sm">
      <a href="#preparation-sources" className="underline underline-offset-4">Partidas y bancos</a>
      <a href="#preparation-operations" className="underline underline-offset-4">Cuentas por operación</a>
      <a href="#preparation-opening" className="underline underline-offset-4">Saldos iniciales</a>
      <a href="#preparation-example" className="underline underline-offset-4">Ver un gasto</a>
    </nav>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {error && <div role="alert" className="space-y-3"><p className="max-w-prose text-sm text-destructive">{error}</p>
      <p className="max-w-prose text-sm text-muted-foreground">No se pudo comprobar la preparación. Puedes continuar con tus gastos y pagos habituales; solicita al administrador que revise la habilitación y tus permisos si el problema persiste.</p>
      <Button variant="outline" onClick={() => reload()}>Volver a consultar preparación</Button></div>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Revisando partidas, bancos y configuración…</p>}
    {data && !error && <>
      <section aria-labelledby="preparation-status" className="space-y-3 bg-muted/50 p-4 sm:p-5">
        <h2 id="preparation-status" className="text-lg font-semibold">{prepared ? "Configuración de gastos y pagos preparada" : "Lo que falta revisar"}</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {data.accounts.length === 0 && <li><a href="#preparation-accounts" className="underline underline-offset-4" onClick={() => setShowAccounts(true)}>Añadir las cuentas del catálogo contable.</a></li>}
          {!data.centers.length && <li>Registra las partidas en el catálogo de centros de costo existente.</li>}
          {missingCenters > 0 && <li><a href="#preparation-sources" className="underline underline-offset-4">Revisar {missingCenters} partida(s) sin cuenta utilizable hoy.</a></li>}
          {!data.banks.length && <li><Link href="/dashboard/finance/settings/bank-accounts" className="underline underline-offset-4">Registrar las cuentas bancarias propias.</Link></li>}
          {missingBanks > 0 && <li><a href="#preparation-banks" className="underline underline-offset-4">Revisar {missingBanks} banco(s) sin cuenta utilizable en MXN.</a></li>}
          {!operationsReady && <li><a href="#preparation-operations" className="underline underline-offset-4">Revisar las cuentas de reconocimiento y pago de gastos.</a></li>}
          {!openingPublished && <li><a href="#preparation-opening" className="underline underline-offset-4">Preparar fecha de arranque y saldos iniciales con su respaldo.</a></li>}
          {data.truncated && <li>El catálogo supera el límite de esta vista. La revisión está incompleta; solicita una revisión administrativa del catálogo.</li>}
          {prepared && <li>Los vínculos, cuentas básicas y apertura están registrados. Revisa un gasto para comprobar sus datos e impuestos.</li>}
        </ul>
        <p className="text-sm font-medium">{data.postingEnabled ? "La contabilización automática está habilitada en este entorno." : "La contabilización automática está deshabilitada en este entorno."}</p>
        <p className="max-w-prose text-sm text-muted-foreground">Guardar esta preparación no activa el piloto. Compras, inventarios, nómina y cierre contable integral tienen entregas pendientes.</p>
      </section>
      <section id="preparation-sources" aria-labelledby="sources-heading" className="scroll-mt-24 space-y-5">
        <div><h2 id="sources-heading" className="text-xl font-semibold">Partidas y bancos que ya utilizas</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">Elige la cuenta correspondiente a cada partida. Pulso conservará también la sucursal y el centro de costo del gasto.</p></div>
        {!data.centers.length ? <p className="text-sm">No hay partidas activas. Se reutiliza el catálogo de centros de costo del control interno.</p>
          : <div className="divide-y">{data.centers.map(center => <SourceMapping key={center.id} id={center.id}
            label={`${center.code} · ${center.name}`} hint={center.accountingLine ?? "Sin clasificación contable operativa"}
            type="costCenterId" accounts={data.accounts} current={linked(center, "costCenterId")}
            onDone={() => reload(`Cuenta vinculada a ${center.name}. Las pólizas anteriores conservan su cuenta.`)}/>)}</div>}
        <div id="preparation-banks" className="scroll-mt-24 border-t pt-5">
          <h3 className="text-lg font-semibold">Bancos de tesorería</h3>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">Cada corrida tomará la cuenta contable vinculada a su banco de origen. Se conservan sus usos de recepción, dispersión o mixto.</p>
          {!data.banks.length ? <p className="mt-4 text-sm">No hay bancos activos. <Link className="underline underline-offset-4" href="/dashboard/finance/settings/bank-accounts">Registrar banco propio</Link></p>
            : <div className="mt-3 divide-y">{data.banks.map(bank => <SourceMapping key={bank.id} id={bank.id}
              label={`${bank.label} · ${bank.lastFour}`} type="bankAccountId" accounts={data.accounts} current={linked(bank, "bankAccountId")}
              hint={`${{ RECEPCION: "Recepción", DISPERSION: "Dispersión", MIXTO: "Mixto" }[bank.purpose]} · ${bank.currency}`}
              disabled={bank.currency !== "MXN"} onDone={() => reload(`Cuenta vinculada a ${bank.label}.`)}/>)}</div>}
        </div>
        <details id="preparation-accounts" open={showAccounts} onToggle={e => setShowAccounts(e.currentTarget.open)} className="scroll-mt-24 border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">Catálogo de cuentas contables · {data.accounts.length} cuenta(s)</summary>
          <p className="mt-3 max-w-prose text-sm text-muted-foreground">Si ya tienes un catálogo, utiliza sus códigos y nombres. Añadir una cuenta aquí no crea otro centro de costo ni una cuenta bancaria.</p>
          {data.accounts.length > 0 && <ul aria-label="Cuentas del catálogo" className="mt-3 max-h-60 space-y-2 overflow-y-auto text-sm">
            {data.accounts.map(account => <li key={account.id}>{account.code} · {account.name}{account.active ? "" : " · inactiva"}{account.postable ? "" : " · acumulativa"}</li>)}
          </ul>}
          <AccountForm onDone={() => reload("Cuenta contable añadida. Ya puedes vincularla con su partida o banco.")}/>
        </details>
      </section>
      <div id="preparation-operations" className="scroll-mt-24"><GuidedAccountingRules accounts={data.accounts} onDone={() => reload()}/></div>
      <section id="preparation-opening" aria-labelledby="initial-heading" className="scroll-mt-24 space-y-3 border-t pt-6">
        <h2 id="initial-heading" className="text-xl font-semibold">Fecha de arranque y saldos iniciales</h2>
        <p className="max-w-prose text-sm text-muted-foreground">Prepara con el responsable contable los saldos de bancos, caja, obligaciones y capital, y la balanza o documento que los respalda. La apertura fija los saldos al cierre de la fecha elegida; los movimientos contables comienzan después de ese día.</p>
        <p className="text-sm">{openingPublished ? "La empresa ya tiene una apertura publicada." : "Todavía no hay una apertura publicada."}</p>
        <Button variant="outline" onClick={() => setShowOpening(value => !value)} aria-expanded={showOpening}>
          {showOpening ? "Cerrar saldos iniciales" : openingPublished ? "Consultar apertura publicada" : "Preparar saldos con el responsable contable"}</Button>
        {showOpening && renderOpening(data.accounts, message => reload(message), setError, data.canPublishOpening)}
      </section>
      <ExpenseExample key={refresh} expenses={data.expenses}/>
    </>}
    {!data && !loading && <section className="space-y-2 text-sm">
      <h2 className="text-lg font-semibold">Qué necesitas para preparar la contabilidad</h2>
      <p className="max-w-prose text-muted-foreground">Tus partidas y bancos existentes, el catálogo de cuentas revisado por el responsable contable y los saldos de arranque con su respaldo. Al habilitar la preparación, podrás revisar cada vínculo aquí.</p>
    </section>}
  </div>;
}

function SourceMapping({ id, label, hint, type, accounts, current, disabled, onDone }: {
  id: string; label: string; hint: string; type: "costCenterId" | "bankAccountId"; accounts: Account[];
  current?: Account; disabled?: boolean; onDone: () => void;
}) {
  const [selected, setSelected] = useState(current?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kinds = type === "bankAccountId" ? ["ASSET"] : ["EXPENSE", "ASSET"];
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      await ledgerRequest("/api/finance/accounting/preparation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link", input: { accountId: selected, [type]: id } }) });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el vínculo."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} aria-label={`Vincular ${label}`} className="grid items-start gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
    <div className="min-w-0"><p className="break-words text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <p className="mt-1 text-xs">{disabled ? "La primera versión contable utiliza MXN." : usable(current, kinds) ? "Cuenta vinculada y utilizable hoy" : "Falta una cuenta vinculada utilizable hoy"}</p></div>
    <div className="grid min-w-0 gap-1 text-sm"><label htmlFor={`source-${id}`}>Cuenta contable para {label}</label>
      <select id={`source-${id}`} className={control} value={selected} disabled={busy || disabled} onChange={e => setSelected(e.target.value)} required>
        <option value="">Selecciona una cuenta</option>
        {accounts.filter(account => usable(account, kinds) || account.id === current?.id).map(account => <option key={account.id} value={account.id} disabled={!usable(account, kinds)}>
          {account.code} · {account.name}{usable(account, kinds) ? "" : " · requiere revisión"}</option>)}
      </select>
      {error && <span role="alert" className="text-destructive">{error}</span>}
    </div>
    <Button className="md:mt-6" variant="outline" type="submit" disabled={busy || disabled || !selected || selected === current?.id}>
      {busy ? "Guardando…" : "Guardar vínculo"}</Button>
  </form>;
}

function AccountForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState("EXPENSE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget, fields = new FormData(form); setBusy(true); setError("");
    try {
      await ledgerRequest("/api/finance/accounting/preparation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "account", input: { code: fields.get("code"), name: fields.get("name"), kind,
          normalBalance: fields.get("normalBalance"), validFrom: fields.get("validFrom"), active: true, postable: true } }) });
      form.reset(); onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo añadir la cuenta."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} aria-label="Añadir cuenta contable" className="mt-4 space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">Código de cuenta<Input name="code" required maxLength={32}/></label>
      <label className="grid gap-1 text-sm">Nombre de cuenta<Input name="name" required maxLength={160}/></label>
      <label className="grid gap-1 text-sm">Tipo de cuenta<select name="kind" className={control} value={kind} onChange={e => setKind(e.target.value)}>
        <option value="EXPENSE">Gasto o costo</option><option value="ASSET">Activo (banco, caja, equipo…)</option>
        <option value="LIABILITY">Pasivo (obligaciones por pagar)</option><option value="EQUITY">Capital</option><option value="INCOME">Ingreso</option>
      </select></label>
      <label className="grid gap-1 text-sm">Naturaleza del saldo<select key={kind} name="normalBalance" className={control} defaultValue={["ASSET", "EXPENSE"].includes(kind) ? "DEBIT" : "CREDIT"}>
        <option value="DEBIT">Deudora</option><option value="CREDIT">Acreedora</option></select></label>
      <label className="grid gap-1 text-sm">Cuenta vigente desde<input className={control} type="date" name="validFrom" defaultValue={ledgerToday()} required/></label>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="outline" type="submit" disabled={busy}>{busy ? "Añadiendo…" : "Añadir cuenta contable"}</Button>
  </form>;
}

function ExpenseExample({ expenses }: { expenses: Preparation["expenses"] }) {
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<ExpensePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function show(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setPreview(null); setError("");
    try { setPreview(await ledgerRequest<ExpensePreview>(`/api/finance/accounting/preparation?expenseId=${selected}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo revisar el gasto."); }
    finally { setBusy(false); }
  }
  return <section id="preparation-example" aria-labelledby="example-heading" className="scroll-mt-24 space-y-4 border-t pt-6">
    <div><h2 id="example-heading" className="text-xl font-semibold">Comprueba cómo se registra un gasto</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">Elige un gasto existente para consultar sus cuentas o lo que falta resolver. Esta consulta no publica pólizas ni cambia el gasto.</p></div>
    {!expenses.length ? <p className="text-sm">Todavía no hay gastos para revisar. <Link href="/dashboard/finance/expenses" className="underline underline-offset-4">Ir a Gastos</Link></p>
      : <form onSubmit={show} className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-0 flex-1 gap-1 text-sm"><label htmlFor="accounting-example-expense">Gasto existente (hasta 30 disponibles)</label>
          <select id="accounting-example-expense" className={control} required value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setPreview(null); setError(""); }}>
            <option value="">Selecciona un gasto</option>{expenses.map(expense => <option key={expense.id} value={expense.id}>
              {expense.description} · {ledgerMoney(expense.amountCents)}</option>)}</select></div>
        <Button type="submit" variant="outline" disabled={busy || !selected}>{busy ? "Consultando…" : "Ver efecto contable"}</Button>
      </form>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {preview && <div role="status" className="space-y-3 text-sm">
      <p className="font-medium">{preview.description} · {preview.date ?? "Sin fecha contable"}</p>
      {preview.reason ? <p>Falta resolver: {preview.reason}</p> : <>
        <p>{preview.published ? "Este gasto ya tiene una póliza publicada. Estas son sus cuentas conservadas." : "Con la configuración actual se utilizarían estas cuentas al reconocer el gasto:"}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-80 text-sm">
          <caption className="sr-only">Cuentas e importes del reconocimiento del gasto</caption>
          <thead className="bg-muted/50"><tr><th scope="col" className="p-3 text-left">Cuenta</th><th scope="col" className="p-3 text-right">Cargo MXN</th><th scope="col" className="p-3 text-right">Abono MXN</th></tr></thead>
          <tbody>{preview.lines.map((line, index) => <tr key={index} className="border-b"><td className="p-3">{line.accountCode} · {line.accountName}</td>
            <td className="p-3 text-right tabular-nums">{ledgerMoney(line.debitCents)}</td><td className="p-3 text-right tabular-nums">{ledgerMoney(line.creditCents)}</td></tr>)}</tbody>
        </table></div>
        <p className="max-w-prose text-muted-foreground">Reconocer registra el gasto o activo y lo que se debe. Al confirmar el pago en tesorería se reduce esa obligación y el saldo contable del banco elegido. El gasto se registra una sola vez.</p>
      </>}
    </div>}
  </section>;
}
