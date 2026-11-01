import { test, expect, type Page } from "@playwright/test";
import { startAccountingBrowserServer } from "../support/accounting-browser-server";
import type { JournalDetail } from "../../components/finance/accounting-types";

let harness:Awaited<ReturnType<typeof startAccountingBrowserServer>>;
test.beforeAll(async()=>{harness=await startAccountingBrowserServer("journals");});
test.afterAll(async()=>{await harness?.server.close();});
const id="10000000-0000-4000-8000-000000000001",replacementId="10000000-0000-4000-8000-000000000002";
const branchId="20000000-0000-4000-8000-000000000001";
const debit="30000000-0000-4000-8000-000000000001",credit="30000000-0000-4000-8000-000000000002";
const initial=(posted=false):JournalDetail=>({id,number:posted?1:null,status:posted?"POSTED":"DRAFT",description:"Renta de Centro",accountingDate:"2026-10-15",
  branchId,version:posted?2:1,reversalOfId:null,replacementOfId:null,businessDate:null,sourceType:null,sourceId:null,
  createdBy:"actor-sintético",createdAt:"2026-10-15T12:00:00Z",postedBy:posted?"revisor-sintético":null,
  postedAt:posted?"2026-10-16T12:00:00Z":null,postingReason:posted?"Revisión de documentos":null,
  lines:[{accountId:debit,accountCode:"5100",accountName:"Gastos de local",costCenterId:null,debitCents:20000,creditCents:0,memo:"Renta de octubre"},
    {accountId:credit,accountCode:"2100",accountName:"Proveedores",costCenterId:null,debitCents:0,creditCents:20000,memo:null}],
  totals:{debitCents:20000,creditCents:20000,balanced:true},related:[]});
async function prepare(page:Page,options:{manager?:boolean;posted?:boolean;failOnce?:boolean;denied?:boolean;empty?:boolean;accountsEmpty?:boolean}={}) {
  const journals=new Map<string,JournalDetail>([[id,initial(options.posted)]]),calls:{action?:string;reason?:string;[key:string]:unknown}[]=[];
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  let failed=false;
  await page.route("**/api/finance/accounting/**",async route=>{
    const req=route.request(),url=new URL(req.url()),key=url.pathname.split("/").at(-1)!;
    const success=(data:unknown)=>route.fulfill({json:{success:true,data}});
    if(options.denied)return route.fulfill({status:403,json:{success:false,error:{message:"No tienes acceso a estas pólizas."}}});
    if(key==="accounts")return success({items:options.accountsEmpty?[]:[{id:debit,code:"5100",name:"Gastos de local",active:true,postable:true},
      {id:credit,code:"2100",name:"Proveedores",active:true,postable:true}],hasMore:false});
    if(req.method()==="GET"&&key==="journals"){
      if(options.failOnce&&!failed){failed=true;return route.fulfill({status:503,json:{success:false,error:{message:"Consulta temporalmente no disponible."}}});}
      const pageNumber=Number(url.searchParams.get("page")??1);
      return success({items:options.empty||url.searchParams.get("branchId")!==branchId?[]:[journals.get(id)],page:pageNumber,pageSize:25,hasMore:pageNumber===1,
        capabilities:{create:!options.manager,update:!options.manager,publish:!options.manager,reverse:!options.manager}});
    }
    if(req.method()==="GET")return success(journals.get(key));
    const body=req.postDataJSON();calls.push(body);
    if(key==="journals"){
      const created={...initial(),...body,id:replacementId,lines:body.lines.map((line:object)=>({...initial().lines[0],...line}))};
      journals.set(replacementId,created);return success(created);
    }
    const current=journals.get(key)!;
    if(body.action==="PUBLISH"){
      const posted={...current,status:"POSTED" as const,number:2,version:current.version+1,postingReason:body.reason,postedBy:"revisor-sintético",postedAt:"2026-11-01T12:00:00Z"};
      journals.set(key,posted);return success(posted);
    }
    if(body.action==="REVERSE"){
      const reversal={...current,id:"reversa-sintética",reversalOfId:key,number:3,postingReason:body.reason};
      const replacement=body.replacement?{...initial(),...body.replacement,id:replacementId,replacementOfId:key}:null;
      if(replacement)journals.set(replacementId,replacement);
      journals.set(key,{...current,related:[reversal,...(replacement?[replacement]:[])]});
      return success({reversal,replacement});
    }
    journals.set(key,{...current,...body,version:current.version+1});return success(journals.get(key));
  });
  await page.goto(harness.url);return {calls,errors,journals};
}

test("reviews with keyboard, requires a motive and publishes once",async({page})=>{
  const {calls,errors}=await prepare(page);
  const trigger=page.getByRole("button",{name:"Revisar Renta de Centro"});await trigger.focus();await page.keyboard.press("Enter");
  await expect(page.getByRole("heading",{name:"Borrador sin folio"})).toBeFocused();
  await page.getByRole("button",{name:"Publicar póliza",exact:true}).click();
  const form=page.getByRole("form",{name:"Autorizar movimiento contable"});
  await expect(form.getByRole("button",{name:"Confirmar publicación"})).toBeDisabled();
  await form.getByLabel("Motivo",{exact:true}).fill("Revisado contra documentos sintéticos");
  await form.getByRole("button",{name:"Confirmar publicación"}).click();
  await expect(page.getByRole("status").filter({hasText:"Póliza publicada"})).toBeVisible();
  await expect(page.getByText("Motivo de publicación: Revisado contra documentos sintéticos")).toBeVisible();
  expect(calls.filter(c=>c.action==="PUBLISH")).toHaveLength(1);expect(errors).toEqual([]);
  await page.getByRole("button",{name:"Cerrar detalle"}).click();await expect(trigger).toBeFocused();
});
test("manager can read and page but cannot capture or publish",async({page})=>{
  await prepare(page,{manager:true});await page.getByRole("button",{name:"Revisar Renta de Centro"}).click();
  await expect(page.getByText("Consulta de tu sucursal.",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:"Publicar póliza",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Nueva póliza"})).toHaveCount(0);
  await page.getByRole("button",{name:"Siguiente",exact:true}).click();await expect(page.getByText("Página 2 ·",{exact:false})).toBeVisible();
});
test("captures a manual draft with exact decimal cents",async({page})=>{
  const {calls}=await prepare(page);await page.getByRole("button",{name:"Nueva póliza"}).click();
  const form=page.getByRole("form",{name:"Capturar póliza"});await form.getByLabel("Concepto",{exact:true}).fill("Compra de material");
  for(const [row,account] of [[1,debit],[2,credit]] as const){
    await form.getByLabel(`Cuenta del renglón ${row}`,{exact:true}).selectOption(account);
    await form.getByLabel(`Importe del renglón ${row}`,{exact:true}).fill("12.29");
  }
  await form.getByRole("button",{name:"Guardar borrador"}).click();await expect(page.getByRole("status").filter({hasText:"Borrador guardado"})).toBeVisible();
  expect(calls[0]).toMatchObject({lines:[{debitCents:1229,creditCents:0},{debitCents:0,creditCents:1229}]});
});
test("corrects through reversal and an unposted replacement",async({page})=>{
  const {calls}=await prepare(page,{posted:true});await page.getByRole("button",{name:"Revisar Renta de Centro"}).click();
  await page.getByRole("button",{name:"Corregir con reemplazo"}).click();
  const form=page.getByRole("form",{name:"Corregir póliza"});await form.getByLabel("Concepto",{exact:true}).fill("Renta de Centro corregida");
  await form.getByLabel("Motivo de corrección",{exact:true}).fill("Corregir clasificación con evidencia");
  await form.getByRole("button",{name:"Publicar reversa y guardar reemplazo"}).click();
  await expect(page.getByRole("status").filter({hasText:"reemplazo guardado como borrador"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Borrador sin folio"})).toBeVisible();
  expect(calls[0]).toMatchObject({action:"REVERSE",expectedVersion:2,reason:"Corregir clasificación con evidencia",replacement:{description:"Renta de Centro corregida"}});
});
test("shows retry, empty and denied states without claiming a successful read",async({page})=>{
  await prepare(page,{failOnce:true});await expect(page.getByRole("alert")).toContainText("temporalmente no disponible");
  await page.getByRole("button",{name:"Volver a consultar"}).click();await expect(page.getByRole("button",{name:"Revisar Renta de Centro"})).toBeVisible();
  await page.unrouteAll({behavior:"wait"});await prepare(page,{denied:true});await expect(page.getByRole("alert")).toContainText("No tienes acceso");
  await expect(page.getByText("Renta de Centro",{exact:true})).toHaveCount(0);
  await page.unrouteAll({behavior:"wait"});await prepare(page,{empty:true});await expect(page.getByRole("heading",{name:"No hay pólizas en esta vista"})).toBeVisible();
});
test("keeps mobile controls in bounds and clears a detail when the branch changes",async({page})=>{
  await page.setViewportSize({width:320,height:900});await prepare(page);await page.getByRole("button",{name:"Revisar Renta de Centro"}).click();
  await expect(page.getByRole("heading",{name:"Borrador sin folio"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole("button",{name:"Norte (prueba)"}).click();
  await expect(page.getByRole("heading",{name:"No hay pólizas en esta vista"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Borrador sin folio"})).toHaveCount(0);
});

test("captures the review and editor at desktop and mobile sizes",async({page})=>{
  const {errors}=await prepare(page);
  for(const [width,name] of [[1440,"desktop"],[320,"mobile"]] as const){
    await page.setViewportSize({width,height:1000});
    await page.getByRole("button",{name:"Revisar Renta de Centro"}).click();
    await expect(page.getByRole("heading",{name:"Borrador sin folio"})).toBeVisible();
    await page.screenshot({path:`.tmp/fc07-${name}.png`,fullPage:true});
    await page.getByRole("button",{name:"Editar borrador"}).click();
    await expect(page.getByRole("combobox",{name:"Cuenta del renglón 1"})).toHaveValue(debit);
    await page.screenshot({path:`.tmp/fc07-editor-${name}.png`,fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole("button",{name:"Cancelar",exact:true}).click();
    await page.getByRole("button",{name:"Cerrar detalle"}).click();
  }
  expect(errors).toEqual([]);
});
test("returns focus to the originating control when canceling an editor",async({page})=>{
  await prepare(page);
  await expect(page.getByRole("main")).toHaveCount(1);
  const create=page.getByRole("button",{name:"Nueva póliza"});await create.click();
  await page.getByRole("button",{name:"Cancelar",exact:true}).click();await expect(create).toBeFocused();
  await page.getByRole("button",{name:"Revisar Renta de Centro"}).click();
  const edit=page.getByRole("button",{name:"Editar borrador"});await edit.click();
  await page.getByRole("button",{name:"Cancelar",exact:true}).click();await expect(edit).toBeFocused();
});
test("keeps the correct account label after removing an earlier line outside the loaded catalog",async({page})=>{
  const {journals}=await prepare(page,{accountsEmpty:true});
  const original=journals.get(id)!;
  original.lines.push({...original.lines[0],accountId:"30000000-0000-4000-8000-000000000003",accountCode:"5200",accountName:"Otros gastos"});
  await page.getByRole("button",{name:"Revisar Renta de Centro"}).click();
  await page.getByRole("button",{name:"Editar borrador"}).click();
  await expect(page.getByRole("button",{name:"Guardar borrador"})).toBeEnabled();
  await page.getByRole("button",{name:"Quitar renglón 1"}).click();
  await expect(page.getByLabel("Cuenta del renglón 1",{exact:true}).locator("option:checked")).toHaveText("2100");
  await expect(page.getByLabel("Cuenta del renglón 2",{exact:true}).locator("option:checked")).toHaveText("5200");
});
