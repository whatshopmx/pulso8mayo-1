import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, branches, recipes, salesEntries, users, evidence } from "@/lib/db/schema";

const mocks=vi.hoisted(()=>({auth:vi.fn(),upload:vi.fn(),sign:vi.fn(),configured:vi.fn(),context:vi.fn()}));
vi.mock("@/lib/tenant-context",()=>({requireAuth:mocks.auth}));
vi.mock("@/lib/storage/r2-client",()=>({uploadToR2:mocks.upload,generatePresignedUrl:mocks.sign,isR2Configured:mocks.configured}));
vi.mock("@/lib/db/tenant-context",async original=>({...await original<typeof import("@/lib/db/tenant-context")>(),withCompanyContext:mocks.context}));
import { setTenantContext } from "@/lib/db/tenant-context";
import { createRecoveryAttachment, getRecoveryAttachmentUrl, removeRecoveryAttachment } from "@/lib/services/sale-recovery-attachments";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture={company:string[];branch:string[];sale:string[];actor:string};
const payload=(f:Fixture)=>({branchId:f.branch[0],legacySaleId:f.sale[0],mimeType:"application/pdf",buffer:Buffer.from("synthetic historical source")});
async function probe(check:(tx:Tx,f:Fixture)=>Promise<void>,failInsert=false){
  const ids=(n:number)=>Array.from({length:n},()=>randomUUID());
  const f={company:ids(2),branch:ids(3),sale:ids(3),actor:randomUUID()};
  mocks.auth.mockReset();mocks.upload.mockReset();mocks.sign.mockReset();mocks.context.mockReset();
  mocks.configured.mockReturnValue(true);mocks.upload.mockResolvedValue("ignored-provider-return");mocks.sign.mockResolvedValue("https://private.test/signed-synthetic");
  await db.transaction(async tx=>{
    await tx.insert(companies).values(f.company.map(id=>({id,name:"Recovery attachment synthetic"})));
    await tx.insert(branches).values(f.branch.map((id,i)=>({id,companyId:f.company[i===2?1:0],name:"Synthetic recovery branch"})));
    const recipe=ids(2);await tx.insert(recipes).values(recipe.map((id,i)=>({id,companyId:f.company[i],name:"Synthetic recipe"})));
    await tx.insert(salesEntries).values(f.sale.map((id,i)=>({id,companyId:f.company[i===2?1:0],branchId:f.branch[i],recipeId:recipe[i===2?1:0],quantitySold:"1",saleDate:new Date("2026-11-01"),totalRevenue:0})));
    await tx.insert(users).values({id:f.actor,name:"Synthetic manager",email:`${f.actor}@recovery.test`,emailVerified:false,createdAt:new Date(),updatedAt:new Date(),role:"GERENTE",companyId:f.company[0],branchId:f.branch[0]});
    if(failInsert){
      const name=`recovery_attachment_failure_${randomUUID().replaceAll("-","")}`;
      await tx.execute(sql.raw(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic attachment failure' USING ERRCODE='23514'; END $$`));
      await tx.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON evidence FOR EACH ROW WHEN (NEW.entity_type::text='SALE_RECOVERY') EXECUTE FUNCTION public.${name}()`));
    }
    await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
    expect((await tx.execute(sql`SELECT current_user AS actor`)).rows[0].actor).toBe("pulso_app");
    mocks.auth.mockResolvedValue({user:{id:f.actor,role:"GERENTE",companyId:f.company[0],branchId:f.branch[0]}});
    mocks.context.mockImplementation((scope,work)=>tx.transaction(async nested=>{await setTenantContext(nested,scope);return work(nested);}));
    await check(tx,f);
    throw new Error("recovery attachments rollback esperado");
  }).catch(error=>{if(!(error instanceof Error)||error.message!=="recovery attachments rollback esperado")throw error;});
  for(const id of f.company)expect(await db.select({id:companies.id}).from(companies).where(eq(companies.id,id))).toEqual([]);
}
describe("evidencia de recuperación: guardia real de entidad y alcance antes de R2 simulado",()=>{
  beforeAll(async()=>{
    const host=(value:string)=>new URL(value).hostname.replace(/-pooler(?=\.)/,"");
    expect(host(process.env.TEST_DATABASE_URL!)).toBe("ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech");
    if(existsSync(".env")){const operational=parse(readFileSync(".env")).DATABASE_URL;if(operational)expect(host(operational)).not.toBe(host(process.env.TEST_DATABASE_URL!));}
    expect((await db.execute(sql`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pulso_app'`)).rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
    expect((await db.execute(sql`SELECT 1 FROM pg_enum WHERE enumtypid='public.evidence_entity_type'::regtype AND enumlabel='SALE_RECOVERY'`)).rows).toHaveLength(1);
  });
  it("guarda autor y clave del servidor, firma después del scope y retira lógicamente sin borrar el objeto",async()=>{
    await probe(async(tx,f)=>{
      const record=await createRecoveryAttachment(payload(f));
      expect(record).toMatchObject({entityId:f.sale[0],branchId:f.branch[0],kind:"FILE"});expect(record).not.toHaveProperty("storageKey");
      const [stored]=await tx.select().from(evidence).where(eq(evidence.id,record.id));
      const key=`companies/${f.company[0]}/branches/${f.branch[0]}/sales-recovery/${f.sale[0]}/${record.id}`;
      expect(stored).toMatchObject({createdBy:f.actor,companyId:f.company[0],entityType:"SALE_RECOVERY",storageKey:key,url:key});
      expect(mocks.upload).toHaveBeenCalledWith(Buffer.from("synthetic historical source"),key,"application/pdf");
      expect(await getRecoveryAttachmentUrl({branchId:f.branch[0],id:record.id})).toEqual({id:record.id,url:"https://private.test/signed-synthetic"});
      expect(mocks.sign).toHaveBeenCalledWith(key,600);
      expect(await removeRecoveryAttachment({branchId:f.branch[0],id:record.id})).toEqual({id:record.id,deleted:true});
      expect((await tx.select().from(evidence).where(eq(evidence.id,record.id)))[0].deletedAt).toBeInstanceOf(Date);
      mocks.sign.mockClear();await expect(getRecoveryAttachmentUrl({branchId:f.branch[0],id:record.id})).rejects.toMatchObject({statusCode:404});expect(mocks.sign).not.toHaveBeenCalled();
    });
  });
  it("venta ajena o sucursal discordante falla antes de subir; administrador no hereda acceso de otra empresa",async()=>{
    await probe(async(_tx,f)=>{
      await expect(createRecoveryAttachment({...payload(f),legacySaleId:f.sale[2]})).rejects.toMatchObject({statusCode:404});
      await expect(createRecoveryAttachment({...payload(f),branchId:f.branch[1]})).rejects.toMatchObject({statusCode:403});
      mocks.auth.mockResolvedValue({user:{id:f.actor,role:"ADMIN",companyId:f.company[0],branchId:null}});
      await expect(createRecoveryAttachment({...payload(f),branchId:f.branch[1]})).rejects.toMatchObject({statusCode:404});
      await expect(createRecoveryAttachment({...payload(f),branchId:f.branch[2],legacySaleId:f.sale[2]})).rejects.toMatchObject({statusCode:404});
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(await createRecoveryAttachment({...payload(f),branchId:f.branch[1],legacySaleId:f.sale[1]})).toMatchObject({branchId:f.branch[1]});
    });
  });
  it("lee una referencia preexistente en DB sin depender de haber ejecutado la carga en este módulo",async()=>{
    await probe(async(tx,f)=>{
      await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0]});
      const id=randomUUID(),key=`companies/${f.company[0]}/branches/${f.branch[0]}/sales-recovery/${f.sale[0]}/${id}`;
      await tx.insert(evidence).values({id,companyId:f.company[0],branchId:f.branch[0],entityType:"SALE_RECOVERY",entityId:f.sale[0],kind:"FILE",url:key,storageKey:key,createdBy:f.actor});
      expect(await getRecoveryAttachmentUrl({branchId:f.branch[0],id})).toMatchObject({id});
      expect(mocks.sign).toHaveBeenCalledWith(key,600);expect(mocks.upload).not.toHaveBeenCalled();
    });
  });
  it("rechaza lectura y baja laterales; GENERAL, entidad discordante y clave externa no obtienen firma",async()=>{
    await probe(async(tx,f)=>{
      const record=await createRecoveryAttachment(payload(f));
      mocks.auth.mockResolvedValue({user:{id:f.actor,role:"ADMIN",companyId:f.company[1],branchId:null}});
      for(const operation of [getRecoveryAttachmentUrl,removeRecoveryAttachment])await expect(operation({branchId:f.branch[2],id:record.id})).rejects.toMatchObject({statusCode:404});
      mocks.auth.mockResolvedValue({user:{id:f.actor,role:"GERENTE",companyId:f.company[0],branchId:f.branch[0]}});
      // Filas corruptas simuladas por dueño; ninguna debe usarse para presignar.
      await tx.execute(sql.raw("RESET ROLE"));
      for(const change of [{entityType:"GENERAL" as const},{entityId:f.sale[2]},{storageKey:"https://example.test/not-a-key"}]){
        const id=randomUUID();await tx.insert(evidence).values({id,companyId:f.company[0],branchId:f.branch[0],entityId:f.sale[0],entityType:"SALE_RECOVERY",url:"synthetic",storageKey:`companies/${f.company[0]}/branches/${f.branch[0]}/sales-recovery/${f.sale[0]}/${id}`,...change});
        await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
        await expect(getRecoveryAttachmentUrl({branchId:f.branch[0],id})).rejects.toMatchObject({statusCode:404});
        await tx.execute(sql.raw("RESET ROLE"));
      }
      expect(mocks.sign).not.toHaveBeenCalled();
    });
  });
  it("fallo de storage no persiste fila ni afecta la venta",async()=>{
    await probe(async(tx,f)=>{
      mocks.upload.mockRejectedValueOnce(new Error("private provider detail"));
      await expect(createRecoveryAttachment(payload(f))).rejects.toMatchObject({statusCode:502,message:"No fue posible guardar la evidencia"});
      await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0]});
      expect(await tx.select().from(evidence)).toEqual([]);
      expect((await tx.select().from(salesEntries).where(eq(salesEntries.id,f.sale[0])))[0].quantitySold).toBe("1.00");
    });
  });
  it("fallo SQL después de subir no publica referencia; caller puede conservar su transacción",async()=>{
    await probe(async(tx,f)=>{
      await expect(createRecoveryAttachment(payload(f))).rejects.toMatchObject({cause:{code:"23514"}});
      await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0]});
      expect(mocks.upload).toHaveBeenCalledTimes(1);expect(await tx.select().from(evidence)).toEqual([]);
      expect((await tx.select().from(salesEntries).where(eq(salesEntries.id,f.sale[0])))[0].quantitySold).toBe("1.00");
    },true);
  });
});
