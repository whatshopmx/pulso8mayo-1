import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";
const mocks=vi.hoisted(()=>({authorize:vi.fn(),list:vi.fn(),create:vi.fn(),detail:vi.fn(),publish:vi.fn(),reverse:vi.fn(),update:vi.fn()}));
vi.mock("@/lib/rbac/abac",()=>({requirePermissionApi:mocks.authorize}));
vi.mock("@/lib/services/accounting/journal-service",async importOriginal=>{
  const actual=await importOriginal<typeof import("@/lib/services/accounting/journal-service")>();
  return {...actual,listJournals:mocks.list,createDraft:mocks.create,getJournal:mocks.detail,publishDraft:mocks.publish,reverseJournal:mocks.reverse,updateDraft:mocks.update};
});
vi.mock("@/lib/db",()=>({db:{}}));
import { GET, POST } from "@/app/api/finance/accounting/journals/route";
import { GET as detailGET, POST as actionPOST } from "@/app/api/finance/accounting/journals/[id]/route";
const company="00000000-0000-4000-8000-000000000001",id="00000000-0000-4000-8000-000000000002";
const params={params:Promise.resolve({id})};
const request=(body:unknown)=>new NextRequest(`http://localhost/api/finance/accounting/journals/${id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("ACCOUNTING_REVIEW_ENABLED","1");mocks.authorize.mockResolvedValue({ctx:{userCompanyId:company,userId:"actor",userRole:"OWNER"},decision:{allowed:true}});});
describe("journal HTTP boundary",()=>{
  it("rejects cross-origin and simple-form writes before invoking the service",async()=>{
    const data={action:"PUBLISH",expectedVersion:1,reason:"Motivo sintético"};
    const cross=new NextRequest(`http://localhost/api/finance/accounting/journals/${id}`,{method:"POST",
      headers:{"Content-Type":"application/json",Origin:"https://untrusted.invalid"},body:JSON.stringify(data)});
    expect((await actionPOST(cross,params)).status).toBe(403);
    const simple=new NextRequest(`http://localhost/api/finance/accounting/journals/${id}`,{method:"POST",body:JSON.stringify(data)});
    expect((await actionPOST(simple,params)).status).toBe(400);expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("keeps public review disabled until explicitly enabled",async()=>{
    vi.stubEnv("ACCOUNTING_REVIEW_ENABLED","0");
    expect((await GET(new NextRequest("http://localhost/api/finance/accounting/journals"))).status).toBe(503);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("requires authentication and never forwards request-supplied principals",async()=>{
    mocks.authorize.mockRejectedValueOnce(ApiError.unauthorized());
    expect((await GET(new NextRequest("http://localhost/api/finance/accounting/journals"))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect((await GET(new NextRequest(`http://localhost/api/finance/accounting/journals?companyId=${id}`))).status).toBe(400);
  });
  it("coerces bounded paging and returns no-store responses even on error",async()=>{
    mocks.list.mockResolvedValue({items:[],page:2});
    const response=await GET(new NextRequest("http://localhost/api/finance/accounting/journals?page=2&pageSize=10"));
    expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.list).toHaveBeenCalledWith({companyId:company,actorId:"actor",role:"OWNER"},{page:2,pageSize:10});
    const bad=await GET(new NextRequest("http://localhost/api/finance/accounting/journals?pageSize=101"));
    expect(bad.status).toBe(400);expect(bad.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("rejects missing motives and validates the specific posting capability",async()=>{
    expect((await actionPOST(request({action:"PUBLISH",expectedVersion:1,reason:" "}),params)).status).toBe(400);
    mocks.publish.mockResolvedValue({id,status:"POSTED"});
    expect((await actionPOST(request({action:"PUBLISH",expectedVersion:1,reason:"Revisado con evidencia"}),params)).status).toBe(200);
    expect(mocks.authorize).toHaveBeenLastCalledWith("accounting","publish",expect.objectContaining({classification:"FINANCIAL"}));
    expect(mocks.publish).toHaveBeenCalledWith({companyId:company,actorId:"actor",role:"OWNER"},id,{expectedVersion:1,reason:"Revisado con evidencia"});
  });
  it("does not let a caller forge automatic provenance or a company",async()=>{
    expect((await POST(request({companyId:company}))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await actionPOST(request({action:"REVERSE",expectedVersion:2,reason:"Corregir duplicado",accountingDate:"2026-10-20",companyId:company}),params)).status).toBe(400);
  });
  it("preserves service denials and hides unexpected database errors",async()=>{
    mocks.detail.mockRejectedValueOnce(ApiError.notFound("Póliza no encontrada."));
    expect((await detailGET(new NextRequest("http://localhost"),params)).status).toBe(404);
    mocks.detail.mockRejectedValueOnce(new Error("PRIVATE SQL WITH BANK DATA"));
    const response=await detailGET(new NextRequest("http://localhost"),params);
    expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
});
