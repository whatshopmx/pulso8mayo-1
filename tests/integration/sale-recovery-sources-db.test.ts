import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { companies, branches, recipes, salesEntries, users, evidence } from '@/lib/db/schema';
const fakes=vi.hoisted(()=>({auth:vi.fn(),context:vi.fn(),read:vi.fn(),sign:vi.fn(),configured:vi.fn()}));
vi.mock('@/lib/tenant-context',()=>({requireAuth:fakes.auth}));
vi.mock('@/lib/storage/r2-client',()=>({getFromR2:fakes.read,generatePresignedUrl:fakes.sign,isR2Configured:fakes.configured}));
vi.mock('@/lib/db/tenant-context',async original=>({...await original<typeof import('@/lib/db/tenant-context')>(),withCompanyContext:fakes.context}));
import { setTenantContext } from '@/lib/db/tenant-context';
import { recordRecoveryAttestation } from '@/lib/services/sale-recovery-attestations';
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture={company:string[];branch:string[];sale:string[];proof:string[];actor:string[]};
const digest='2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'; // SHA-256 conocido de "hello".
const body=(f:Fixture)=>({branchId:f.branch[0],legacySaleId:f.sale[0],evidenceId:f.proof[0],idempotencyKey:randomUUID(),purpose:'SALE',sourceReference:'Corte original 001',reason:'Inspección documental por administrador',expectedContentSha256:digest});
async function count(tx:Tx,f:Fixture){await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});return(await tx.execute(sql`SELECT count(*)::int AS n FROM sale_recovery_attestations`)).rows[0].n;}
async function probe(work:(tx:Tx,f:Fixture)=>Promise<void>){
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
    await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
    fakes.auth.mockResolvedValue({user:{id:f.actor[0],role:'ADMIN',companyId:f.company[0]}});
    fakes.context.mockImplementation((scope,work)=>tx.transaction(async nested=>{await setTenantContext(nested,scope);return work(nested);}));
    await work(tx,f);throw new Error('server attestations rollback esperado');
  }).catch(error=>{if(!(error instanceof Error)||error.message!=='server attestations rollback esperado')throw error;});
  expect((await db.execute(sql`SELECT to_regclass('public.sale_recovery_attestations') AS relation`)).rows[0].relation).toBeNull();
  for(const id of f.company)expect((await db.execute(sql`SELECT id FROM companies WHERE id=${id}`)).rows).toEqual([]);
}

import { readRecoverySourceDocument } from '@/lib/services/sale-recovery-sources';
async function source(tx:Tx,f:Fixture,purpose='SALE',patch:Record<string,unknown>={}){
 await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});
 const [sale]=await tx.select().from(salesEntries).where(eq(salesEntries.id,f.sale[0]));
 const document={schemaVersion:1,kind:purpose==='NO_PRIOR_CONSUMPTION'?'SALE_RECOVERY_NO_PRIOR_CONSUMPTION':'SALE_RECOVERY_SALE',
  companyId:f.company[0],branchId:f.branch[0],legacySaleId:f.sale[0],recipeId:sale.recipeId,sourceReference:'Corte original 001',
  source:'pos:main',productKey:'SKU-01',saleDay:'2026-11-01',quantitySold:'1',totalRevenueCents:null,
  ...(purpose==='NO_PRIOR_CONSUMPTION'?{consumptionState:'NOT_APPLIED',basis:{system:'POS',recordReference:'Registro íntegro 001',explanation:'Inventario no ejecutado según registro del origen'}}:{}),...patch};
 const bytes=Buffer.from(JSON.stringify(document));fakes.read.mockResolvedValue(bytes);
 const fact=await recordRecoveryAttestation({...body(f),purpose,sourceReference:'Corte original 001',expectedContentSha256:createHash('sha256').update(bytes).digest('hex')});
 fakes.read.mockClear();return{bytes,fact,document,input:{branchId:f.branch[0],legacySaleId:f.sale[0],attestationId:fact.id,purpose}};
}
describe('fuentes SALE y NO_PRIOR_CONSUMPTION desde SQL runtime y bytes',()=>{
 beforeAll(async()=>{
  const host=(value:string)=>new URL(value).hostname.replace(/-pooler(?=\.)/,'');expect(host(process.env.TEST_DATABASE_URL!)).toBe('ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech');
  if(existsSync('.env')){const url=parse(readFileSync('.env')).DATABASE_URL;if(url)expect(host(url)).not.toBe(host(process.env.TEST_DATABASE_URL!));}
  expect((await db.execute(sql`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pulso_app'`)).rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
 });
 it('retorna declaraciones, ingreso desconocido y metadatos nativos sin crear hechos',async()=>{
  await probe(async(tx,f)=>{
   for(const purpose of ['SALE','NO_PRIOR_CONSUMPTION']){
    const h=await source(tx,f,purpose),result=await readRecoverySourceDocument(h.input);
    expect(result.document).toMatchObject({quantitySold:'1.00',totalRevenueCents:null,identity:{saleDay:'2026-11-01',productKey:'SKU-01'}});
    expect(result.evidence).toMatchObject({id:f.proof[0],attestationId:h.fact.id,purpose,verifiedRole:'ADMIN',deletedAt:null,
     evidenceUpdatedAt:'2026-11-01T00:00:00.123456Z',createdAt:'2026-11-01T00:00:00.000000Z'});
    expect(result.evidence.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    if(purpose==='NO_PRIOR_CONSUMPTION')expect(result.document).toHaveProperty('basis.recordReference','Registro íntegro 001');
   }
   expect(await count(tx,f)).toBe(2);expect(fakes.sign).not.toHaveBeenCalled();
   expect(fakes.read).toHaveBeenCalledWith(expect.any(String),{maxBytes:2097152,timeoutMs:15000});
   expect((await tx.select({quantity:salesEntries.quantitySold}).from(salesEntries).where(eq(salesEntries.id,f.sale[0])))[0].quantity).toBe('1.00');
  });
 });
 it('versión cambiada un microsegundo, finalidad cruzada y retiro fallan antes del objeto',async()=>{
  await probe(async(tx,f)=>{
   const h=await source(tx,f);
   await expect(readRecoverySourceDocument({...h.input,purpose:'NO_PRIOR_CONSUMPTION'})).rejects.toMatchObject({statusCode:404});
   await tx.execute(sql`UPDATE evidence SET updated_at=updated_at+interval '0.000001 second' WHERE id=${f.proof[0]}`);
   await expect(readRecoverySourceDocument(h.input)).rejects.toMatchObject({statusCode:404});
   const next=await source(tx,f);await tx.update(evidence).set({deletedAt:new Date()}).where(eq(evidence.id,f.proof[0]));
   await expect(readRecoverySourceDocument(next.input)).rejects.toMatchObject({statusCode:404});expect(fakes.read).not.toHaveBeenCalled();
  });
 });
 it('no admite objetos cambiados, proveedor fallido ni declaraciones discordantes atestiguadas',async()=>{
  await probe(async(tx,f)=>{
   const h=await source(tx,f),changed=Buffer.from(h.bytes);changed[changed.length-2]^=1;
   for(const bytes of [null,Buffer.alloc(0),changed,Buffer.alloc(2097153)]){
    fakes.read.mockResolvedValueOnce(bytes);await expect(readRecoverySourceDocument(h.input)).rejects.toMatchObject({statusCode:409});
   }
   fakes.read.mockRejectedValueOnce(new Error('provider private'));await expect(readRecoverySourceDocument(h.input)).rejects.toMatchObject({statusCode:502});
   for(const patch of [{quantitySold:'2'},{legacySaleId:f.sale[1]},{sourceReference:'Otro corte'},{recipeId:randomUUID()}]){
    const invalid=await source(tx,f,'SALE',patch);await expect(readRecoverySourceDocument(invalid.input)).rejects.toMatchObject({statusCode:409});
   }
   const absence=await source(tx,f,'NO_PRIOR_CONSUMPTION',{basis:undefined});await expect(readRecoverySourceDocument(absence.input)).rejects.toMatchObject({statusCode:409});
  });
 });
 it('venta, empresa y sucursal ajenas no permiten consultar el objeto',async()=>{
  await probe(async(tx,f)=>{
   const h=await source(tx,f);
   await expect(readRecoverySourceDocument({...h.input,legacySaleId:f.sale[1]})).rejects.toMatchObject({statusCode:404});
   await expect(readRecoverySourceDocument({...h.input,branchId:f.branch[1]})).rejects.toMatchObject({statusCode:404});
   fakes.auth.mockResolvedValue({user:{id:f.actor[2],role:'ADMIN',companyId:f.company[1]}});
   await expect(readRecoverySourceDocument(h.input)).rejects.toMatchObject({statusCode:404});expect(fakes.read).not.toHaveBeenCalled();
  });
 });
 it('receta lateral y cantidad modificada bloquean la declaración de la venta',async()=>{
  await probe(async(tx,f)=>{
   const h=await source(tx,f);await tx.execute(sql.raw('RESET ROLE'));
   await tx.update(salesEntries).set({quantitySold:'2'}).where(eq(salesEntries.id,f.sale[0]));
   await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
   await expect(readRecoverySourceDocument(h.input)).rejects.toMatchObject({statusCode:409});fakes.read.mockClear();
   await tx.execute(sql.raw('RESET ROLE'));
   await tx.execute(sql`UPDATE sales_entries SET recipe_id=(SELECT recipe_id FROM sales_entries WHERE id=${f.sale[2]}) WHERE id=${f.sale[0]}`);
   await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
   await expect(readRecoverySourceDocument(h.input)).rejects.toMatchObject({statusCode:404});expect(fakes.read).not.toHaveBeenCalled();
  });
 });
});

