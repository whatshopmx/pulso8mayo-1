import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { companies, branches, recipes, salesEntries, users, evidence, saleRecoveryAttestations } from '@/lib/db/schema';
const fakes=vi.hoisted(()=>({auth:vi.fn(),context:vi.fn(),read:vi.fn(),sign:vi.fn(),configured:vi.fn()}));
vi.mock('@/lib/tenant-context',()=>({requireAuth:fakes.auth}));
vi.mock('@/lib/storage/r2-client',()=>({getFromR2:fakes.read,generatePresignedUrl:fakes.sign,isR2Configured:fakes.configured}));
vi.mock('@/lib/db/tenant-context',async original=>({...await original<typeof import('@/lib/db/tenant-context')>(),withCompanyContext:fakes.context}));
import { setTenantContext } from '@/lib/db/tenant-context';
import { previewRecoveryAttestation, recordRecoveryAttestation } from '@/lib/services/sale-recovery-attestations';
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture={company:string[];branch:string[];sale:string[];proof:string[];actor:string[]};
const digest='2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'; // SHA-256 conocido de "hello".
const body=(f:Fixture)=>({branchId:f.branch[0],legacySaleId:f.sale[0],evidenceId:f.proof[0],idempotencyKey:randomUUID(),purpose:'SALE',sourceReference:'Corte original 001',reason:'Inspección documental por administrador',expectedContentSha256:digest});
async function count(tx:Tx,f:Fixture){await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});return(await tx.execute(sql`SELECT count(*)::int AS n FROM sale_recovery_attestations`)).rows[0].n;}
async function probe(work:(tx:Tx,f:Fixture)=>Promise<void>,failAfterInsert=false){
  const ids=(n:number)=>Array.from({length:n},()=>randomUUID());const f={company:ids(2),branch:ids(3),sale:ids(3),proof:ids(3),actor:ids(3)};
  fakes.auth.mockReset();fakes.context.mockReset();fakes.read.mockReset();fakes.sign.mockReset();
  fakes.configured.mockReturnValue(true);fakes.read.mockResolvedValue(Buffer.from('hello'));fakes.sign.mockResolvedValue('https://private.test/signed');
  await db.transaction(async tx=>{
    for(const statement of readFileSync('drizzle/0145_inv01c_recovery_attestations.sql','utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await tx.execute(sql.raw(statement));
    await tx.insert(companies).values(f.company.map(id=>({id,name:'Synthetic server attestation'})));
    await tx.insert(branches).values(f.branch.map((id,i)=>({id,companyId:f.company[i===2?1:0],name:'Synthetic branch'})));
    const recipe=ids(2);await tx.insert(recipes).values(recipe.map((id,i)=>({id,companyId:f.company[i],name:'Synthetic recipe'})));
    await tx.insert(salesEntries).values(f.sale.map((id,i)=>({id,companyId:f.company[i===2?1:0],branchId:f.branch[i],recipeId:recipe[i===2?1:0],quantitySold:'1',saleDate:new Date('2026-11-01'),totalRevenue:0})));
    await tx.insert(users).values(f.actor.map((id,i)=>({id,name:'Synthetic administrator',email:`${id}@attestation.test`,emailVerified:false,createdAt:new Date(),updatedAt:new Date(),role:'ADMIN' as const,companyId:f.company[i===2?1:0]})));
    await tx.insert(evidence).values(f.proof.map((id,i)=>{const companyId=f.company[i===2?1:0],branchId=f.branch[i],key=`companies/${companyId}/branches/${branchId}/sales-recovery/${f.sale[i]}/${id}`;return{id,companyId,branchId,entityType:'SALE_RECOVERY' as const,entityId:f.sale[i],url:key,storageKey:key,kind:'FILE' as const,createdAt:new Date('2026-11-01'),createdBy:f.actor[i===2?2:0]};}));
    await tx.update(evidence).set({updatedAt:sql`'2026-11-01 00:00:00.123456'::timestamp`}).where(inArray(evidence.id,f.proof));
    if(failAfterInsert){
      const name=`attestation_failure_${randomUUID().replaceAll('-','')}`;
      await tx.execute(sql.raw(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic post-insert failure' USING ERRCODE='23514'; END $$`));
      await tx.execute(sql.raw(`CREATE TRIGGER ${name} AFTER INSERT ON sale_recovery_attestations FOR EACH ROW EXECUTE FUNCTION public.${name}()`));
    }
    await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
    fakes.auth.mockResolvedValue({user:{id:f.actor[0],role:'ADMIN',companyId:f.company[0]}});
    fakes.context.mockImplementation((scope,work)=>tx.transaction(async nested=>{await setTenantContext(nested,scope);return work(nested);}));
    await work(tx,f);throw new Error('server attestations rollback esperado');
  }).catch(error=>{if(!(error instanceof Error)||error.message!=='server attestations rollback esperado')throw error;});
  expect((await db.execute(sql`SELECT to_regclass('public.sale_recovery_attestations') AS relation`)).rows[0].relation).toBeNull();
  for(const id of f.company)expect((await db.execute(sql`SELECT id FROM companies WHERE id=${id}`)).rows).toEqual([]);
}
describe('atestación de servidor con SQL real y objeto/sesión simulados',()=>{
  beforeAll(async()=>{
    const host=(value:string)=>new URL(value).hostname.replace(/-pooler(?=\.)/,'');expect(host(process.env.TEST_DATABASE_URL!)).toBe('ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech');
    if(existsSync('.env')){const url=parse(readFileSync('.env')).DATABASE_URL;if(url)expect(host(url)).not.toBe(host(process.env.TEST_DATABASE_URL!));}
    expect((await db.execute(sql`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pulso_app'`)).rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
  });
  it('preview calcula hash de bytes, firma clave propia y no atestigua; POST registra una vez con actor real y versión nativa',async()=>{
    await probe(async(tx,f)=>{
      const preview=await previewRecoveryAttestation({branchId:f.branch[0],evidenceId:f.proof[0]});
      expect(preview).toMatchObject({contentSha256:digest,byteLength:5,url:'https://private.test/signed'});expect(await count(tx,f)).toBe(0);
      const input=body(f),first=await recordRecoveryAttestation(input),second=await recordRecoveryAttestation(input);
      expect(first).toMatchObject({created:true,contentSha256:digest,byteLength:5,verifiedBy:f.actor[0],verifiedRole:'ADMIN'});
      expect(first).not.toHaveProperty('storageKey');expect(second).toEqual({...first,created:false});expect(await count(tx,f)).toBe(1);
      expect((await tx.execute(sql`SELECT a.evidence_updated_at=e.updated_at AS exact,to_char(a.evidence_updated_at,'US') AS micros FROM sale_recovery_attestations a JOIN evidence e ON e.id=a.evidence_id`)).rows[0]).toEqual({exact:true,micros:'123456'});
      expect(fakes.read).toHaveBeenCalledWith(`companies/${f.company[0]}/branches/${f.branch[0]}/sales-recovery/${f.sale[0]}/${f.proof[0]}`,{maxBytes:20971520,timeoutMs:15000});
    });
  });
  it('no acepta hash esperado falso ni objeto ausente, vacío, excesivo o error de proveedor',async()=>{
    await probe(async(tx,f)=>{
      await expect(recordRecoveryAttestation({...body(f),expectedContentSha256:'0'.repeat(64)})).rejects.toMatchObject({statusCode:409});
      for(const value of [null,Buffer.alloc(0),Buffer.alloc(20971521)]){fakes.read.mockResolvedValueOnce(value);await expect(recordRecoveryAttestation(body(f))).rejects.toMatchObject({statusCode:409});}
      fakes.read.mockRejectedValueOnce(new Error('private provider detail'));await expect(recordRecoveryAttestation(body(f))).rejects.toMatchObject({statusCode:502,message:'No fue posible comprobar el objeto privado'});
      expect(await count(tx,f)).toBe(0);
    });
  });
  it('rechaza otra empresa, tipo GENERAL y adjunto retirado antes de descargar o firmar',async()=>{
    await probe(async(tx,f)=>{
      await expect(recordRecoveryAttestation({...body(f),legacySaleId:f.sale[1]})).rejects.toMatchObject({statusCode:409});
      await expect(recordRecoveryAttestation({...body(f),branchId:f.branch[2],evidenceId:f.proof[2]})).rejects.toMatchObject({statusCode:404});
      await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});
      await tx.update(evidence).set({entityType:'GENERAL'}).where(eq(evidence.id,f.proof[0]));await expect(recordRecoveryAttestation(body(f))).rejects.toMatchObject({statusCode:404});
      await tx.update(evidence).set({entityType:'SALE_RECOVERY',deletedAt:new Date()}).where(eq(evidence.id,f.proof[0]));await expect(previewRecoveryAttestation({branchId:f.branch[0],evidenceId:f.proof[0]})).rejects.toMatchObject({statusCode:404});
      expect(fakes.read).not.toHaveBeenCalled();expect(fakes.sign).not.toHaveBeenCalled();expect(await count(tx,f)).toBe(0);
    });
  });
  it('la clave no se puede reutilizar con otro cuerpo, otro actor o un microsegundo de diferencia; conserva el hecho previo',async()=>{
    await probe(async(tx,f)=>{
      const input=body(f),first=await recordRecoveryAttestation(input);
      fakes.read.mockResolvedValueOnce(Buffer.from('changed'));await expect(recordRecoveryAttestation(input)).rejects.toMatchObject({statusCode:409});
      await expect(recordRecoveryAttestation({...input,reason:'Otra revisión'})).rejects.toMatchObject({statusCode:409});
      fakes.auth.mockResolvedValue({user:{id:f.actor[1],role:'ADMIN',companyId:f.company[0]}});await expect(recordRecoveryAttestation(input)).rejects.toMatchObject({statusCode:409});
      fakes.auth.mockResolvedValue({user:{id:f.actor[0],role:'ADMIN',companyId:f.company[0]}});
      await tx.execute(sql`UPDATE evidence SET updated_at=updated_at+interval '0.000001 second' WHERE id=${f.proof[0]}`);
      await expect(recordRecoveryAttestation(input)).rejects.toMatchObject({statusCode:409});
      expect(await count(tx,f)).toBe(1);expect((await tx.select().from(saleRecoveryAttestations))[0].id).toBe(first.id);
      expect(await recordRecoveryAttestation({...input,idempotencyKey:randomUUID()})).toMatchObject({created:true});expect(await count(tx,f)).toBe(2);
    });
  });
  it('fallo después del INSERT revierte el hecho y no expone referencia o motivo en el error público',async()=>{
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    try{
      await probe(async(tx,f)=>{
        await expect(recordRecoveryAttestation({...body(f),reason:'SYNTHETIC_PRIVATE_REVIEW_NOTE'})).rejects.toMatchObject({statusCode:500,message:'No fue posible registrar la atestación'});
        expect(await count(tx,f)).toBe(0);
        expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_REVIEW_NOTE');
      },true);
    }finally{log.mockRestore();}
  });
});
