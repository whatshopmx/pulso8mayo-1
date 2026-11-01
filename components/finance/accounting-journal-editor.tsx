"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toCents } from "@/lib/services/accounting/amounts";
import { ledgerDecimal, ledgerMoney, ledgerRequest, ledgerToday, type JournalDetail, type LedgerAccount } from "./accounting-types";

type Line={accountId:string;side:"DEBIT"|"CREDIT";amount:string;memo:string;costCenterId:string|null};
const control="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export function AccountingJournalEditor({original,correction=false,branchId,branches,onDone,onCancel}:{
  original?:JournalDetail;correction?:boolean;branchId:string|null;branches:{id:string;name:string}[];
  onDone:(id:string,message:string)=>void;onCancel:()=>void;
}) {
  const [date,setDate]=useState(correction?ledgerToday():original?.accountingDate??ledgerToday());
  const [description,setDescription]=useState(original?.description??"");
  const [branch,setBranch]=useState(original?.branchId??branchId??"");
  const [reason,setReason]=useState("");
  const [lines,setLines]=useState<Line[]>(original?.lines.map(l=>({accountId:l.accountId,side:l.debitCents?"DEBIT":"CREDIT",
    amount:ledgerDecimal(l.debitCents||l.creditCents),memo:l.memo??"",costCenterId:l.costCenterId}))??[
      {accountId:"",side:"DEBIT",amount:"",memo:"",costCenterId:null},{accountId:"",side:"CREDIT",amount:"",memo:"",costCenterId:null}]);
  const [accounts,setAccounts]=useState<LedgerAccount[]>([]),[accountPage,setAccountPage]=useState(1),[hasMore,setHasMore]=useState(false);
  const [accountReload,setAccountReload]=useState(0);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const heading=useRef<HTMLHeadingElement>(null),live=useRef(true);
  useEffect(()=>{live.current=true;heading.current?.focus();return()=>{live.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError("");
    ledgerRequest<{items:LedgerAccount[];hasMore:boolean}>(`/api/finance/accounting/accounts?page=${accountPage}`,{signal:controller.signal})
      .then(data=>{setAccounts(previous=>accountPage===1?data.items:[...previous,...data.items]);setHasMore(data.hasMore);})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[accountPage,accountReload]);
  function change(index:number,patch:Partial<Line>){setLines(previous=>previous.map((line,i)=>i===index?{...line,...patch}:line));}
  async function save(event:React.FormEvent) {
    event.preventDefault();setError("");setBusy(true);
    try {
      const parsed=lines.map(l=>({accountId:l.accountId,costCenterId:l.costCenterId,memo:l.memo||null,
        debitCents:l.side==="DEBIT"?toCents(l.amount):0,creditCents:l.side==="CREDIT"?toCents(l.amount):0}));
      if(parsed.some(l=>!l.accountId||l.debitCents+l.creditCents===0))throw new Error("Selecciona una cuenta y un importe positivo en cada renglón.");
      const draft={accountingDate:date,businessDate:original?.businessDate??null,description,branchId:branch||null,lines:parsed};
      if(correction&&original){
        const result=await ledgerRequest<{replacement:{id:string}}>(`/api/finance/accounting/journals/${original.id}`,{
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"REVERSE",expectedVersion:original.version,
            accountingDate:date,reason,replacement:draft})});
        if(live.current)onDone(result.replacement.id,"Reversa publicada y reemplazo guardado como borrador.");
      }else{
        const result=await ledgerRequest<{id:string}>(`/api/finance/accounting/journals${original?`/${original.id}`:""}`,{
          method:original?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...draft,...(original?{expectedVersion:original.version}:{})})});
        if(live.current)onDone(result.id,"Borrador guardado. Revisa sus cargos y abonos antes de publicarlo.");
      }
    }catch(e){if(live.current)setError(e instanceof Error?e.message:"No se pudo guardar el borrador.");}
    finally{if(live.current)setBusy(false);}
  }
  let debit=0,credit=0;
  try{for(const line of lines){const amount=line.amount?toCents(line.amount):0;if(line.side==="DEBIT")debit+=amount;else credit+=amount;}}catch{/* Validation is shown on submit. */}
  return <form onSubmit={save} className="space-y-5 border-t pt-6" aria-label={correction?"Corregir póliza":"Capturar póliza"}>
    <div><h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">{correction?"Reversa y reemplazo":original?"Editar borrador":"Nueva póliza"}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{correction?"La original se conserva. Se publicará su reversa y el reemplazo quedará pendiente de revisión.":"Los borradores pueden quedar descuadrados. Publicar exige cuentas vigentes y cargos iguales a abonos."}</p></div>
    <fieldset disabled={busy} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium">Fecha contable<Input type="date" value={date} required disabled={!!original?.replacementOfId&&!correction} onChange={e=>setDate(e.target.value)}/></label>
        <label className="space-y-1 text-sm font-medium">Sucursal<select className={control} value={branch} disabled={correction} onChange={e=>setBranch(e.target.value)}>
          <option value="">Corporativo · sin sucursal</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      </div>
      <label className="block space-y-1 text-sm font-medium">Concepto<Input required maxLength={500} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      {correction&&<label className="block space-y-1 text-sm font-medium">Motivo de corrección<textarea className={control} minLength={5} maxLength={500} required value={reason} onChange={e=>setReason(e.target.value)}/></label>}
      <div className="space-y-3">{lines.map((line,index)=><fieldset key={index} className="rounded-md border p-3">
        <legend className="px-1 text-xs font-medium">Renglón {index+1}</legend>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_9rem]">
          <label className="space-y-1 text-sm">Cuenta<select aria-label={`Cuenta del renglón ${index+1}`} className={control} required value={line.accountId} onChange={e=>change(index,{accountId:e.target.value})}>
            <option value="">{loading?"Cargando cuentas…":"Selecciona una cuenta"}</option>
            {line.accountId&&!accounts.some(a=>a.id===line.accountId)&&<option value={line.accountId}>{original?.lines.find(originalLine=>originalLine.accountId===line.accountId)?.accountCode??line.accountId}</option>}
            {accounts.filter(a=>a.active&&a.postable).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
          <label className="space-y-1 text-sm">Lado<select className={control} value={line.side} onChange={e=>change(index,{side:e.target.value as Line["side"]})}><option value="DEBIT">Cargo</option><option value="CREDIT">Abono</option></select></label>
          <label className="space-y-1 text-sm">Importe MXN<Input aria-label={`Importe del renglón ${index+1}`} required inputMode="decimal" value={line.amount} onChange={e=>change(index,{amount:e.target.value})}/></label>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 space-y-1 text-sm">Nota opcional<Input maxLength={200} value={line.memo} onChange={e=>change(index,{memo:e.target.value})}/></label>
          <Button type="button" variant="ghost" disabled={lines.length<=2} onClick={()=>setLines(previous=>previous.filter((_,i)=>i!==index))} aria-label={`Quitar renglón ${index+1}`}>Quitar</Button></div>
      </fieldset>)}</div>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={lines.length>=200} onClick={()=>setLines(previous=>[...previous,{accountId:"",side:"DEBIT",amount:"",memo:"",costCenterId:null}])}>Añadir renglón</Button>
        {hasMore&&<Button type="button" variant="ghost" disabled={loading} onClick={()=>setAccountPage(p=>p+1)}>Cargar más cuentas</Button>}</div>
      <p className="text-sm tabular-nums" aria-live="polite">Cargos {ledgerMoney(debit)} · Abonos {ledgerMoney(credit)} · Diferencia {ledgerMoney(debit-credit)}</p>
    </fieldset>
    {error&&<div role="alert" className="space-y-2"><p className="text-sm text-destructive">{error}</p>
      {accounts.length===0&&<Button type="button" variant="outline" disabled={loading} onClick={()=>setAccountReload(n=>n+1)}>Volver a cargar cuentas</Button>}</div>}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy||loading}>{busy?"Guardando…":correction?"Publicar reversa y guardar reemplazo":"Guardar borrador"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancelar</Button></div>
  </form>;
}
