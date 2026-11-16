import { beforeEach, describe, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({session:vi.fn(),preview:vi.fn(),record:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:f.session}}}));
vi.mock('next/headers',()=>({headers:async()=>new Headers()}));
vi.mock('@/lib/services/sale-recovery-attestations',()=>({previewRecoveryAttestation:f.preview,recordRecoveryAttestation:f.record}));
import { GET, POST } from '@/app/api/inventory/sales-entry/recovery-attestations/route';
import { ApiError } from '@/lib/api/error';
const id='10000000-0000-4000-8000-000000000001',url='http://localhost/api/inventory/sales-entry/recovery-attestations';
const input={branchId:id,legacySaleId:id,evidenceId:id,idempotencyKey:id,purpose:'SALE',sourceReference:'Corte original',reason:'Revisado',expectedContentSha256:'a'.repeat(64)};
const json=(body:string)=>new Request(url,{method:'POST',body,headers:{'content-type':'application/json'}});
beforeEach(()=>{vi.resetAllMocks();f.session.mockResolvedValue({user:{id:'actor',role:'ADMIN',companyId:id}});f.preview.mockResolvedValue({contentSha256:'a'.repeat(64),url:'https://private.test/signed'});f.record.mockResolvedValue({id,created:true});});
describe('rutas administrativas de atestación',()=>{
  it('sesión o rol insuficiente se rechazan antes de consumir el body',async()=>{
    for(const user of [null,{id:'actor',role:'GERENTE',companyId:id},{id:'actor',companyId:id}]){
      f.session.mockResolvedValue(user?{user}:null);const req=new Request(url,{method:'POST',body:JSON.stringify(input)});const read=vi.spyOn(req.body!,'getReader');
      expect((await POST(req)).status).toBe(user?403:401);expect(read).not.toHaveBeenCalled();
    }
    expect(f.record).not.toHaveBeenCalled();
  });
  it('preview no cacheable exige solo ID/sucursal y no permite elegir empresa desde query',async()=>{
    const response=await GET(new Request(`${url}?branchId=${id}&evidenceId=${id}`));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(f.preview).toHaveBeenCalledWith({branchId:id,evidenceId:id});expect((await GET(new Request(`${url}?branchId=${id}&evidenceId=${id}&companyId=${id}`))).status).toBe(400);
  });
  it('crea o repite el hecho sin alterar los campos de autoridad del servicio',async()=>{
    expect((await POST(json(JSON.stringify(input)))).status).toBe(201);expect(f.record).toHaveBeenCalledWith(input);
    f.record.mockResolvedValueOnce({id,created:false});expect((await POST(json(JSON.stringify(input)))).status).toBe(200);
    f.record.mockRejectedValueOnce(ApiError.conflict('El contenido cambió'));expect((await POST(json(JSON.stringify(input)))).status).toBe(409);
  });
  it('OWNER del catálogo canónico conserva acceso administrativo',async()=>{
    f.session.mockResolvedValue({user:{id:'actor',role:'OWNER',companyId:id}});
    expect((await POST(json(JSON.stringify(input)))).status).toBe(201);
  });
  it('JSON inválido y exceso real de stream no llegan al servicio',async()=>{
    expect((await POST(json('{'))).status).toBe(400);
    expect((await POST(new Request(url,{method:'POST',body:JSON.stringify(input)}))).status).toBe(400);
    const cancel=vi.fn(),body=new ReadableStream({start(c){c.enqueue(new Uint8Array(16385));},cancel});
    const req=new Request(url,{method:'POST',body,duplex:'half',headers:{'content-type':'application/json'}} as RequestInit);expect((await POST(req)).status).toBe(413);expect(cancel).toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
  });
});
