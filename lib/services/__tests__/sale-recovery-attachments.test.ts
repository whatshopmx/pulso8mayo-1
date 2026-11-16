import { beforeEach, describe, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({auth:vi.fn(),context:vi.fn(),upload:vi.fn(),sign:vi.fn(),configured:vi.fn()}));
vi.mock("@/lib/tenant-context",()=>({requireAuth:f.auth}));
vi.mock("@/lib/db/tenant-context",()=>({withCompanyContext:f.context}));
vi.mock("@/lib/storage/r2-client",()=>({uploadToR2:f.upload,generatePresignedUrl:f.sign,isR2Configured:f.configured}));
import { createRecoveryAttachment, getRecoveryAttachmentUrl, removeRecoveryAttachment } from "../sale-recovery-attachments";
const companyId="10000000-0000-4000-8000-000000000001",branchId="10000000-0000-4000-8000-000000000002",legacySaleId="10000000-0000-4000-8000-000000000003";
const input=()=>({branchId,legacySaleId,mimeType:"application/pdf",buffer:Buffer.from("historical source")});
beforeEach(()=>{vi.resetAllMocks();f.auth.mockResolvedValue({user:{id:"actor",companyId,branchId,role:"GERENTE"}});f.configured.mockReturnValue(true);});
describe("frontera autenticada de adjuntos de recuperación",()=>{
  it("rechaza autoridad del cuerpo, URL sin bytes, tipo/tamaño inválidos antes de DB o storage",async()=>{
    for(const data of [{...input(),companyId},{...input(),role:"ADMIN"},{...input(),verified:true},{branchId,legacySaleId,url:"https://example.test/fake"},
      {...input(),buffer:Buffer.alloc(0)},{...input(),buffer:Buffer.alloc(20*1024*1024+1)},{...input(),mimeType:"text/html"},{...input(),branchId:"invalid"}])
      await expect(createRecoveryAttachment(data)).rejects.toMatchObject({statusCode:400});
    expect(f.context).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();
  });
  it("sesión ausente o sin capacidad no llega a DB, subida, firma o borrado",async()=>{
    f.auth.mockRejectedValueOnce(Object.assign(new Error("Unauthorized"),{statusCode:401}));
    await expect(createRecoveryAttachment(input())).rejects.toMatchObject({statusCode:401});
    for(const role of [undefined,"EMPLEADO","SUPERVISOR","READONLY","invented"]){
      f.auth.mockResolvedValue({user:{id:"actor",companyId,branchId,role}});
      await expect(createRecoveryAttachment(input())).rejects.toMatchObject({statusCode:403});
      await expect(getRecoveryAttachmentUrl({branchId,id:legacySaleId})).rejects.toMatchObject({statusCode:403});
      await expect(removeRecoveryAttachment({branchId,id:legacySaleId})).rejects.toMatchObject({statusCode:403});
    }
    expect(f.context).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();expect(f.sign).not.toHaveBeenCalled();
  });
  it("no amplía gerente a otra sucursal ni convierte falta de sucursal en toda la empresa",async()=>{
    await expect(createRecoveryAttachment({...input(),branchId:legacySaleId})).rejects.toMatchObject({statusCode:403});
    f.auth.mockResolvedValue({user:{id:"actor",companyId,role:"GERENTE",branchId:null}});
    await expect(createRecoveryAttachment(input())).rejects.toMatchObject({statusCode:403});
    expect(f.context).not.toHaveBeenCalled();
  });
  it("R2 ausente falla cerrado sin guardar una referencia local",async()=>{
    f.configured.mockReturnValue(false);
    await expect(createRecoveryAttachment(input())).rejects.toMatchObject({statusCode:503});
    expect(f.upload).not.toHaveBeenCalled();expect(f.context).not.toHaveBeenCalled();
  });
});
