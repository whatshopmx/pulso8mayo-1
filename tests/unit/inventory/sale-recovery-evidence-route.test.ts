import { beforeEach, describe, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({session:vi.fn(),create:vi.fn(),get:vi.fn(),remove:vi.fn()}));
vi.mock("@/lib/auth",()=>({auth:{api:{getSession:f.session}}}));
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
vi.mock("@/lib/services/sale-recovery-attachments",()=>({createRecoveryAttachment:f.create,getRecoveryAttachmentUrl:f.get,removeRecoveryAttachment:f.remove}));
import { POST, GET, DELETE } from "@/app/api/inventory/sales-entry/recovery-evidence/route";
import { ApiError } from "@/lib/api/error";
const branchId="10000000-0000-4000-8000-000000000002",id="10000000-0000-4000-8000-000000000003";
const url="http://localhost/api/inventory/sales-entry/recovery-evidence";
function form(){const data=new FormData();data.set("branchId",branchId);data.set("legacySaleId",id);data.set("file",new File(["synthetic"],"source.pdf",{type:"application/pdf"}));return data;}
beforeEach(()=>{vi.resetAllMocks();f.session.mockResolvedValue({user:{id:"actor",companyId:id,branchId,role:"GERENTE"}});f.create.mockResolvedValue({id,branchId,entityId:id});f.get.mockResolvedValue({id,url:"https://private.test/signed"});f.remove.mockResolvedValue({id,deleted:true});});
describe("HTTP de evidencia de recuperación",()=>{
  it("autentica y exige capacidad antes de leer el body",async()=>{
    for(const user of [null,{id:"actor",companyId:id,role:"EMPLEADO"},{id:"actor",companyId:id}]){
      f.session.mockResolvedValue(user?{user}:null);
      const req=new Request(url,{method:"POST",body:form()});const read=vi.spyOn(req.body!,"getReader");
      expect((await POST(req)).status).toBe(user?403:401);expect(read).not.toHaveBeenCalled();
    }
    expect(f.create).not.toHaveBeenCalled();
  });
  it("limita el tamaño declarado y el stream real sin depender de Content-Length",async()=>{
    expect((await POST(new Request(url,{method:"POST",body:form(),headers:{"content-length":"999999999"}}))).status).toBe(413);
    const cancel=vi.fn();const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(21*1024*1024));c.enqueue(new Uint8Array(1));},cancel});
    const req=new Request(url,{method:"POST",body,duplex:"half",headers:{"content-type":"multipart/form-data; boundary=x"}} as RequestInit);
    expect((await POST(req)).status).toBe(413);expect(cancel).toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
  });
  it("solo envía bytes e identificadores del sujeto al servicio; no URL ni autoridad del cuerpo",async()=>{
    const response=await POST(new Request(url,{method:"POST",body:form()}));expect(response.status).toBe(201);
    expect(f.create).toHaveBeenCalledWith({branchId,legacySaleId:id,mimeType:"application/pdf",buffer:Buffer.from("synthetic")});
    const forbidden=form();forbidden.set("companyId",id);
    expect((await POST(new Request(url,{method:"POST",body:forbidden}))).status).toBe(400);
    const duplicate=form();duplicate.append("branchId",id);
    expect((await POST(new Request(url,{method:"POST",body:duplicate}))).status).toBe(400);
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("firma solo por id/sucursal y no deja cachear URL privada; propaga 404 sin revelar datos",async()=>{
    const response=await GET(new Request(`${url}?branchId=${branchId}&id=${id}`));expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");expect(f.get).toHaveBeenCalledWith({id,branchId});
    expect((await GET(new Request(`${url}?branchId=${branchId}&id=${id}&companyId=${id}`))).status).toBe(400);
    f.get.mockRejectedValueOnce(ApiError.notFound("Evidencia no encontrada"));expect((await GET(new Request(`${url}?branchId=${branchId}&id=${id}`))).status).toBe(404);
  });
  it("DELETE usa baja lógica del servicio y rechaza JSON inválido",async()=>{
    expect((await DELETE(new Request(url,{method:"DELETE",body:JSON.stringify({id,branchId})}))).status).toBe(200);
    expect(f.remove).toHaveBeenCalledWith({id,branchId});
    expect((await DELETE(new Request(url,{method:"DELETE",body:"{"}))).status).toBe(400);
    expect(f.remove).toHaveBeenCalledTimes(1);
  });
});
