"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountingJournalEditor } from "./accounting-journal-editor";
import { ledgerMoney, ledgerRequest, ledgerToday, type JournalDetail, type JournalList } from "./accounting-types";

const base="/api/finance/accounting/journals";
export function AccountingJournals({branchId,branches}:{branchId:string|null;branches:{id:string;name:string}[]}) {
  const [page,setPage]=useState(1),[status,setStatus]=useState(""),[refresh,setRefresh]=useState(0);
  const [list,setList]=useState<JournalList|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<JournalDetail|null>(null);
  const [detailError,setDetailError]=useState(""),[detailLoading,setDetailLoading]=useState(false);
  const [editor,setEditor]=useState<"new"|"edit"|"correct"|null>(null),[approval,setApproval]=useState<"PUBLISH"|"REVERSE"|null>(null);
  const [reason,setReason]=useState(""),[date,setDate]=useState(ledgerToday()),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const heading=useRef<HTMLHeadingElement>(null),reasonField=useRef<HTMLTextAreaElement>(null),live=useRef(true);
  const restoreFocus=useRef<string|null>(null);
  const restoreEditorFocus=useRef<"new"|"edit"|"correct"|null>(null);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setList(null);setError("");
    const query=new URLSearchParams({page:String(page)});
    if(branchId)query.set("branchId",branchId);if(status)query.set("status",status);
    ledgerRequest<JournalList>(`${base}?${query}`,{signal:controller.signal}).then(setList)
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[page,status,refresh,branchId]);
  useEffect(()=>{
    setDetail(null);setDetailError("");setApproval(null);setReason("");
    if(!selected){setDetailLoading(false);return;}
    const controller=new AbortController();setDetailLoading(true);
    ledgerRequest<JournalDetail>(`${base}/${selected}`,{signal:controller.signal}).then(data=>{
      setDetail(data);requestAnimationFrame(()=>heading.current?.focus());
    }).catch(e=>{if(!controller.signal.aborted)setDetailError(e.message);}).finally(()=>{if(!controller.signal.aborted)setDetailLoading(false);});
    return()=>controller.abort();
  },[selected,refresh]);
  useEffect(()=>{if(approval)reasonField.current?.focus();},[approval]);
  useEffect(()=>{
    if(!selected&&!loading&&restoreFocus.current){
      const trigger=Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-journal-trigger]"))
        .find(button=>button.dataset.journalTrigger===restoreFocus.current&&button.getClientRects().length>0);
      if(trigger){trigger.focus();restoreFocus.current=null;}
    }
  },[selected,loading,list]);
  useEffect(()=>{
    if(!editor&&restoreEditorFocus.current){
      document.querySelector<HTMLButtonElement>(`button[data-editor-trigger="${restoreEditorFocus.current}"]`)?.focus();
      restoreEditorFocus.current=null;
    }
  },[editor]);
  const completed=(id:string,message:string)=>{setEditor(null);setApproval(null);setSelected(id);setNotice(message);setRefresh(n=>n+1);};
  async function approve(event:React.FormEvent) {
    event.preventDefault();if(!detail||!approval)return;
    setBusy(true);setDetailError("");
    try {
      await ledgerRequest(`${base}/${detail.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        action:approval,expectedVersion:detail.version,reason,...(approval==="REVERSE"?{accountingDate:date}:{})})});
      if(live.current)completed(detail.id,approval==="PUBLISH"?"Póliza publicada. Sus renglones quedan protegidos.":"Reversa publicada. La póliza original se conserva.");
    }catch(e){if(live.current)setDetailError(e instanceof Error?e.message:"No se pudo completar la revisión.");}
    finally{if(live.current)setBusy(false);}
  }
  const branchName=(id:string|null)=>id?branches.find(b=>b.id===id)?.name??id:"Corporativo";
  const alreadyReversed=detail?.related.some(row=>row.reversalOfId===detail.id&&row.status==="POSTED");
  return <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
    <div><Link href="/dashboard/finance/control-interno" className="text-sm text-muted-foreground underline underline-offset-4">Volver a Cierre y control</Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Pólizas</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">Revisa cargos y abonos, publica ajustes y conserva el historial de cada corrección.</p></div>
        {list?.capabilities.create&&!editor&&<Button data-editor-trigger="new" onClick={()=>{setEditor("new");setSelected(null);}}>Nueva póliza</Button>}</div></div>
    {notice&&<p role="status" className="rounded-md bg-muted px-4 py-3 text-sm">{notice}</p>}
    {editor?<AccountingJournalEditor key={`${editor}-${selected??"new"}`} original={editor==="new"?undefined:detail??undefined}
      correction={editor==="correct"} branchId={branchId} branches={branches} onDone={completed} onCancel={()=>{restoreEditorFocus.current=editor;setEditor(null);}}/>:
      <><div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <label className="flex items-center gap-2 text-sm">Estado<select value={status} disabled={busy} onChange={e=>{setStatus(e.target.value);setPage(1);setSelected(null);}}
          className="min-h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="">Todos</option><option value="DRAFT">Borradores</option><option value="POSTED">Publicadas</option></select></label>
        <p className="text-sm text-muted-foreground">{branchId?branchName(branchId):"Empresa · incluye partidas corporativas"} · MXN</p></div>
      {loading?<div aria-label="Cargando pólizas" role="status" className="space-y-3">{[1,2,3].map(n=><div key={n} className="h-16 rounded-md bg-muted motion-safe:animate-pulse"/>)}</div>:
        error?<div role="alert" className="space-y-3"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={()=>setRefresh(n=>n+1)}>Volver a consultar</Button></div>:
        list?.items.length===0?<div className="py-8"><h2 className="text-lg font-semibold">No hay pólizas en esta vista</h2>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">{status?"Prueba otro estado o vuelve a la página anterior.":"Las pólizas aparecerán aquí cuando se capturen y revisen los primeros movimientos."}</p></div>:
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Pólizas del ámbito seleccionado, página {page}</caption>
          <thead className="hidden border-b text-xs text-muted-foreground sm:table-header-group"><tr>{["Póliza","Fecha contable","Sucursal","Estado","Revisión"].map(text=><th key={text} scope="col" className="px-3 py-3 font-medium">{text}</th>)}</tr></thead>
          <tbody>{list?.items.map(row=><tr key={row.id} className={`grid grid-cols-2 border-b sm:table-row ${selected===row.id?"bg-muted/60":""}`}>
            <td className="col-span-2 min-w-0 px-3 py-3 sm:min-w-48"><span className="font-medium">{row.number?`Póliza ${row.number}`:"Sin folio"}</span><p className="mt-1 max-w-md break-words text-muted-foreground">{row.description}</p></td>
            <td className="whitespace-nowrap px-3 py-3 tabular-nums"><span className="block text-xs text-muted-foreground sm:hidden">Fecha contable</span>{row.accountingDate}</td><td className="px-3 py-3"><span className="block text-xs text-muted-foreground sm:hidden">Sucursal</span>{branchName(row.branchId)}</td>
            <td className="px-3 py-3"><span className="rounded bg-secondary px-2 py-1 text-xs">{row.status==="POSTED"?"Publicada":"Borrador"}</span>
              {(row.reversalOfId||row.replacementOfId)&&<p className="mt-2 text-xs text-muted-foreground">{row.reversalOfId?"Reversa":"Reemplazo"}</p>}</td>
            <td className="px-3 py-3"><Button data-journal-trigger={row.id} variant="outline" size="sm" disabled={busy} onClick={()=>{setSelected(row.id);setNotice("");}} aria-label={`Revisar ${row.description}`}>Revisar</Button></td>
          </tr>)}</tbody></table></div>}
      {!error&&!loading&&list&&<nav aria-label="Paginación de pólizas" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Página {page} · Hasta {list.pageSize} pólizas por página</p><div className="flex gap-2">
          <Button variant="outline" disabled={busy||page===1} onClick={()=>{setPage(p=>p-1);setSelected(null);}}>Anterior</Button>
          <Button variant="outline" disabled={busy||!list.hasMore} onClick={()=>{setPage(p=>p+1);setSelected(null);}}>Siguiente</Button></div></nav>}
      {detailLoading&&<p role="status" className="text-sm text-muted-foreground">Cargando renglones e historial…</p>}
      {detailError&&<div role="alert" className="space-y-2"><p className="text-sm text-destructive">{detailError}</p>
        {!busy&&<Button variant="outline" onClick={()=>setRefresh(n=>n+1)}>Actualizar póliza</Button>}</div>}
      {detail&&<section aria-labelledby="journal-detail-heading" className="space-y-5 border-t pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 ref={heading} tabIndex={-1} id="journal-detail-heading" className="text-xl font-semibold">{detail.number?`Póliza ${detail.number}`:"Borrador sin folio"}</h2>
          <p className="mt-1 break-words text-sm">{detail.description}</p><p className="mt-1 text-sm text-muted-foreground">{detail.accountingDate} · {branchName(detail.branchId)} · Versión {detail.version}</p></div>
          <Button variant="ghost" disabled={busy} onClick={()=>{restoreFocus.current=detail.id;setSelected(null);}}>Cerrar detalle</Button></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Renglones contables en pesos mexicanos</caption>
          <thead className="border-b text-xs text-muted-foreground"><tr><th scope="col" className="px-3 py-2">Cuenta y nota</th><th scope="col" className="px-3 py-2 text-right">Cargo MXN</th><th scope="col" className="px-3 py-2 text-right">Abono MXN</th></tr></thead>
          <tbody>{detail.lines.map((line,i)=><tr key={i} className="border-b"><td className="min-w-24 px-2 py-3 sm:min-w-48 sm:px-3"><span className="font-medium">{line.accountCode} · {line.accountName}</span>{line.memo&&<p className="mt-1 break-words text-muted-foreground">{line.memo}</p>}</td>
            <td className="px-2 py-3 text-right tabular-nums sm:px-3">{ledgerMoney(line.debitCents)}</td><td className="px-2 py-3 text-right tabular-nums sm:px-3">{ledgerMoney(line.creditCents)}</td></tr>)}</tbody>
          <tfoot><tr className="font-semibold"><th scope="row" className="px-3 py-3">Total</th><td className="px-3 py-3 text-right tabular-nums">{ledgerMoney(detail.totals.debitCents)}</td><td className="px-3 py-3 text-right tabular-nums">{ledgerMoney(detail.totals.creditCents)}</td></tr></tfoot>
        </table></div>
        <p className="text-sm">{detail.totals.balanced?"Cargos y abonos coinciden.":"La póliza está descuadrada. Corrige los renglones antes de publicar."}</p>
        <div className="space-y-2 text-sm"><h3 className="font-semibold">Origen e historial</h3>
          <p className="text-muted-foreground">Capturada el {detail.createdAt?.slice(0,10)}<span className="block break-all">Actor {detail.createdBy}</span></p>
          <p className="break-all text-muted-foreground">{detail.sourceType?`${detail.sourceType} · ${detail.sourceId}`:"Captura manual"}</p>
          {detail.postingReason&&<><p className="break-words">Motivo de publicación: {detail.postingReason}</p><p className="break-all text-muted-foreground">Publicada el {detail.postedAt?.slice(0,10)} · Actor {detail.postedBy}</p></>}
          {alreadyReversed&&<p>Esta póliza ya tiene una reversa publicada.</p>}
          {detail.related.map(row=><div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2">
            <Button variant="link" className="h-auto whitespace-normal p-0 text-left" disabled={busy} onClick={()=>setSelected(row.id)}>{row.reversalOfId?"Reversa":row.replacementOfId?"Reemplazo":"Original"} · {row.number?`Póliza ${row.number}`:"Borrador"}</Button>
            <span className="text-muted-foreground">{row.accountingDate} · {row.status==="POSTED"?"Publicada":"Borrador"}</span>{row.postingReason&&<p className="w-full break-words">{row.postingReason}</p>}</div>)}
        </div>
        {!approval&&<div className="flex flex-wrap gap-2">
          {detail.status==="DRAFT"&&list?.capabilities.update&&!detail.sourceType&&<Button data-editor-trigger="edit" variant="outline" onClick={()=>setEditor("edit")}>Editar borrador</Button>}
          {detail.status==="DRAFT"&&list?.capabilities.publish&&<Button disabled={!detail.totals.balanced||detail.lines.length<2} onClick={()=>setApproval("PUBLISH")}>Publicar póliza</Button>}
          {detail.status==="POSTED"&&!detail.reversalOfId&&!alreadyReversed&&list?.capabilities.reverse&&<>
            <Button variant="outline" onClick={()=>setApproval("REVERSE")}>Revertir póliza</Button><Button data-editor-trigger="correct" variant="outline" onClick={()=>setEditor("correct")}>Corregir con reemplazo</Button></>}
          {!list?.capabilities.create&&<p className="text-sm text-muted-foreground">Consulta de tu sucursal. La publicación y corrección requieren autorización contable.</p>}
        </div>}
        {approval&&<form onSubmit={approve} className="space-y-4 rounded-md bg-muted p-4" aria-label="Autorizar movimiento contable">
          <h3 className="font-semibold">{approval==="PUBLISH"?"Confirmar publicación":"Confirmar reversa"}</h3>
          <p className="max-w-prose text-sm text-muted-foreground">{approval==="PUBLISH"?"La póliza publicada quedará protegida. Cualquier corrección posterior se registra con una reversa.":"Se publicará una póliza con cargos y abonos invertidos. La original se conservará."}</p>
          {approval==="REVERSE"&&<label className="block max-w-xs space-y-1 text-sm font-medium">Fecha de la reversa<Input type="date" required disabled={busy} value={date} onChange={e=>setDate(e.target.value)}/></label>}
          <label className="block space-y-1 text-sm font-medium">Motivo<textarea ref={reasonField} required minLength={5} maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}
            className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"/></label>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy||reason.trim().length<5}>{busy?"Registrando…":approval==="PUBLISH"?"Confirmar publicación":"Confirmar reversa"}</Button>
            <Button variant="outline" type="button" disabled={busy} onClick={()=>setApproval(null)}>Cancelar revisión</Button></div>
        </form>}
      </section>}</>}
  </div>;
}
