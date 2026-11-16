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
import { readRecoveryHistoricalRecipe } from '@/lib/services/sale-recovery-historical';
import { saleSnapshotDemand } from '@/lib/services/sale-consumption-snapshot';

async function historical(tx:Tx,f:Fixture,purpose='RECIPE_VERSION',value?:Buffer){
 const [sale]=await tx.select().from(salesEntries).where(eq(salesEntries.id,f.sale[0]));
 const ingredient=randomUUID();
 const document={schemaVersion:1,kind:'SALE_RECOVERY_RECIPE',companyId:f.company[0],branchId:f.branch[0],legacySaleId:f.sale[0],recipeId:sale.recipeId,
  saleDay:'2026-11-01',validFrom:'2026-10-01',validThrough:'2026-11-30',sourceReference:'Recetario firmado versión 001',
  recipes:[{id:sale.recipeId,companyId:f.company[0],baseYield:'2',unit:'PORTION',items:[{id:randomUUID(),itemId:ingredient,quantity:'500',unit:'G',isSubRecipe:false,yieldPercent:100}]}],
  ingredients:[{id:ingredient,companyId:f.company[0],unit:'KG'}],conversions:[{id:randomUUID(),companyId:f.company[0],fromUnit:'G',toUnit:'KG',factor:'0.001'}]};
 const bytes=value??Buffer.from(JSON.stringify(document));fakes.read.mockResolvedValue(bytes);
 const fact=await recordRecoveryAttestation({...body(f),purpose,sourceReference:document.sourceReference,expectedContentSha256:createHash('sha256').update(bytes).digest('hex')});
 fakes.read.mockClear();return{input:{branchId:f.branch[0],legacySaleId:f.sale[0],attestationId:fact.id},bytes,fact,document,ingredient};
}
describe('receta histórica desde atestación SQL y bytes verificados',()=>{
 beforeAll(async()=>{
  const host=(value:string)=>new URL(value).hostname.replace(/-pooler(?=\.)/,'');expect(host(process.env.TEST_DATABASE_URL!)).toBe('ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech');
  if(existsSync('.env')){const url=parse(readFileSync('.env')).DATABASE_URL;if(url)expect(host(url)).not.toBe(host(process.env.TEST_DATABASE_URL!));}
  expect((await db.execute(sql`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pulso_app'`)).rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
 });
 it('lee finalidad/version nativa, verifica bytes y reconstruye receta sin catálogo mutable ni DML',async()=>{
  await probe(async(tx,f)=>{
   await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});
   const h=await historical(tx,f),first=await readRecoveryHistoricalRecipe(h.input);
   expect(first).toMatchObject({attestationId:h.fact.id,evidenceId:f.proof[0],saleDay:'2026-11-01',sourceReference:h.document.sourceReference});
   expect(first).not.toHaveProperty('storageKey');
   expect(saleSnapshotDemand(first.recipeSnapshot,'3')).toEqual([{itemId:h.ingredient,unit:'KG',quantity:'0.7500'}]);
   // Solo preparación de fixture como dueño; no ampliar permisos del runtime para modificar recetas.
   await tx.execute(sql.raw('RESET ROLE'));
   await tx.update(recipes).set({baseYield:'99'}).where(eq(recipes.id,h.document.recipeId));
   await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
   expect((await readRecoveryHistoricalRecipe(h.input)).recipeSnapshot).toEqual(first.recipeSnapshot);
   expect(await count(tx,f)).toBe(1);expect(fakes.sign).not.toHaveBeenCalled();
   expect(fakes.read).toHaveBeenCalledWith(`companies/${f.company[0]}/branches/${f.branch[0]}/sales-recovery/${f.sale[0]}/${f.proof[0]}`,{maxBytes:2097152,timeoutMs:15000});
  });
 });
 it('no lee objetos con versión obsoleta por un microsegundo, propósito ajeno o adjunto retirado',async()=>{
  await probe(async(tx,f)=>{
   await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});
   const wrong=await historical(tx,f,'SALE');await expect(readRecoveryHistoricalRecipe(wrong.input)).rejects.toMatchObject({statusCode:404});
   const h=await historical(tx,f);await tx.execute(sql`UPDATE evidence SET updated_at=updated_at+interval '0.000001 second' WHERE id=${f.proof[0]}`);
   await expect(readRecoveryHistoricalRecipe(h.input)).rejects.toMatchObject({statusCode:404});
   const next=await historical(tx,f);await tx.update(evidence).set({deletedAt:new Date()}).where(eq(evidence.id,f.proof[0]));
   await expect(readRecoveryHistoricalRecipe(next.input)).rejects.toMatchObject({statusCode:404});expect(fakes.read).not.toHaveBeenCalled();
  });
 });
 it('no acepta bytes cambiados/ausentes ni JSON inválido aunque tenga una atestación',async()=>{
  await probe(async(tx,f)=>{
   await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});
   const h=await historical(tx,f);
   for(const value of [null,Buffer.alloc(0),Buffer.from('different'),Buffer.alloc(2097153)]){fakes.read.mockResolvedValueOnce(value);await expect(readRecoveryHistoricalRecipe(h.input)).rejects.toMatchObject({statusCode:409});}
   fakes.read.mockRejectedValueOnce(new Error('private provider failure'));await expect(readRecoveryHistoricalRecipe(h.input)).rejects.toMatchObject({statusCode:502,message:'No fue posible comprobar el documento histórico'});
   const invalid=await historical(tx,f,'RECIPE_VERSION',Buffer.from('not JSON'));
   await expect(readRecoveryHistoricalRecipe(invalid.input)).rejects.toMatchObject({statusCode:409});expect(await count(tx,f)).toBe(2);
  });
 });
 it('rechaza una venta cuyo ID de receta apunta a otra empresa antes de R2',async()=>{
  await probe(async(tx,f)=>{
   await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});
   const h=await historical(tx,f);
   await tx.execute(sql.raw('RESET ROLE'));
   await tx.execute(sql`UPDATE sales_entries SET recipe_id=(SELECT recipe_id FROM sales_entries WHERE id=${f.sale[2]}) WHERE id=${f.sale[0]}`);
   await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
   await expect(readRecoveryHistoricalRecipe(h.input)).rejects.toMatchObject({statusCode:404});
   expect(fakes.read).not.toHaveBeenCalled();
  });
 });
 it('sujeto/tenant/campos de autoridad ajenos y rol no administrativo fallan antes de R2',async()=>{
  await probe(async(tx,f)=>{
   await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});
   const h=await historical(tx,f);
   await expect(readRecoveryHistoricalRecipe({...h.input,legacySaleId:f.sale[1]})).rejects.toMatchObject({statusCode:404});
   await expect(readRecoveryHistoricalRecipe({...h.input,companyId:f.company[0],recipeSnapshot:{}})).rejects.toMatchObject({statusCode:400});
   fakes.auth.mockResolvedValue({user:{id:f.actor[2],role:'ADMIN',companyId:f.company[1]}});await expect(readRecoveryHistoricalRecipe(h.input)).rejects.toMatchObject({statusCode:404});
   for(const role of ['GERENTE','SUPERVISOR',undefined]){fakes.auth.mockResolvedValue({user:{id:f.actor[0],role,companyId:f.company[0],branchId:f.branch[0]}});await expect(readRecoveryHistoricalRecipe(h.input)).rejects.toMatchObject({statusCode:403});}
   expect(fakes.read).not.toHaveBeenCalled();
  });
 });
});
