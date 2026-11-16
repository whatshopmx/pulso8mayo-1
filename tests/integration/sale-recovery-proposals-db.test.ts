import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { companies, branches, recipes, salesEntries, users, evidence, inventoryItems, saleRecoveryProposals, salesConsumptionIdentities, salesConsumptionRevisions } from '@/lib/db/schema';
const fakes=vi.hoisted(()=>({auth:vi.fn(),context:vi.fn(),read:vi.fn(),sign:vi.fn(),configured:vi.fn()}));
vi.mock('@/lib/tenant-context',()=>({requireAuth:fakes.auth}));
vi.mock('@/lib/storage/r2-client',()=>({getFromR2:fakes.read,generatePresignedUrl:fakes.sign,isR2Configured:fakes.configured}));
vi.mock('@/lib/db/tenant-context',async original=>({...await original<typeof import('@/lib/db/tenant-context')>(),withCompanyContext:fakes.context}));
import { setTenantContext } from '@/lib/db/tenant-context';
import { recordRecoveryAttestation } from '@/lib/services/sale-recovery-attestations';
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture={company:string[];branch:string[];sale:string[];proof:string[];actor:string[];item:string[]};
const digest='2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'; // SHA-256 conocido de "hello".
const body=(f:Fixture)=>({branchId:f.branch[0],legacySaleId:f.sale[0],evidenceId:f.proof[0],idempotencyKey:randomUUID(),purpose:'SALE',sourceReference:'Corte original 001',reason:'Inspección documental por administrador',expectedContentSha256:digest});
async function count(tx:Tx,f:Fixture){await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});return(await tx.execute(sql`SELECT count(*)::int AS n FROM sale_recovery_attestations`)).rows[0].n;}
async function probe(work:(tx:Tx,f:Fixture)=>Promise<void>){
  const ids=(n:number)=>Array.from({length:n},()=>randomUUID());const f={company:ids(2),branch:ids(3),sale:ids(3),proof:ids(3),actor:ids(3),item:ids(2)};
  fakes.auth.mockReset();fakes.context.mockReset();fakes.read.mockReset();fakes.sign.mockReset();
  fakes.configured.mockReturnValue(true);fakes.read.mockResolvedValue(Buffer.from('hello'));fakes.sign.mockResolvedValue('https://private.test/signed');
  await db.transaction(async tx=>{
    for(const statement of readFileSync('drizzle/0143_inv01c_recovery_review.sql','utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await tx.execute(sql.raw(statement));
    for(const statement of readFileSync('drizzle/0145_inv01c_recovery_attestations.sql','utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await tx.execute(sql.raw(statement));
    await tx.insert(companies).values(f.company.map(id=>({id,name:'Synthetic server attestation'})));
    await tx.insert(inventoryItems).values(f.item.map((id,i)=>({id,companyId:f.company[i],name:'Synthetic recovery ingredient',unit:'KG'})));
    await tx.insert(branches).values(f.branch.map((id,i)=>({id,companyId:f.company[i===2?1:0],name:'Synthetic branch'})));
    const recipe=ids(2);await tx.insert(recipes).values(recipe.map((id,i)=>({id,companyId:f.company[i],name:'Synthetic recipe'})));
    await tx.insert(salesEntries).values(f.sale.map((id,i)=>({id,companyId:f.company[i===2?1:0],branchId:f.branch[i],recipeId:recipe[i===2?1:0],quantitySold:'1',saleDate:new Date('2026-11-01'),totalRevenue:0})));
    await tx.insert(users).values(f.actor.map((id,i)=>({id,name:'Synthetic administrator',email:`${id}@attestation.test`,emailVerified:false,createdAt:new Date(),updatedAt:new Date(),role:'ADMIN' as const,companyId:f.company[i===2?1:0]})));
    await tx.insert(evidence).values(f.proof.map((id,i)=>{const companyId=f.company[i===2?1:0],branchId=f.branch[i],key=`companies/${companyId}/branches/${branchId}/sales-recovery/${f.sale[i]}/${id}`;return{id,companyId,branchId,entityType:'SALE_RECOVERY' as const,entityId:f.sale[i],url:key,storageKey:key,kind:'FILE' as const,createdAt:new Date('2026-11-01'),createdBy:f.actor[i===2?2:0]};}));
    await tx.update(evidence).set({updatedAt:sql`'2026-11-01 00:00:00.123456'::timestamp`}).where(inArray(evidence.id,f.proof));
    await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
    fakes.auth.mockResolvedValue({user:{id:f.actor[0],role:'ADMIN',companyId:f.company[0]}});
    fakes.context.mockImplementation((scope,work)=>tx.transaction(async nested=>{await setTenantContext(nested,scope);return work(nested);}));
    const spy=vi.spyOn(db,'transaction').mockImplementation(work=>tx.transaction(work));
    try{await work(tx,f);}finally{spy.mockRestore();}
    throw new Error('server attestations rollback esperado');
  },{isolationLevel:'serializable'}).catch(error=>{if(!(error instanceof Error)||error.message!=='server attestations rollback esperado')throw error;});
  expect((await db.execute(sql`SELECT to_regclass('public.sale_recovery_attestations') AS relation`)).rows[0].relation).toBeNull();
  expect((await db.execute(sql`SELECT to_regclass('public.sale_recovery_proposals') AS relation`)).rows[0].relation).toBeNull();
  for(const id of f.company)expect((await db.execute(sql`SELECT id FROM companies WHERE id=${id}`)).rows).toEqual([]);
}

import { registerRecoveryProposal } from '@/lib/services/sale-recovery-proposals';
import { prepareSaleRecoveryReview } from '@/lib/services/sale-recovery-review';
import { decodeRecoveryHistoricalRecipe } from '@/lib/services/sale-recovery-historical-recipe';

async function bundle(tx:Tx,f:Fixture,patch:{sale?:Record<string,unknown>;absence?:Record<string,unknown>;recipe?:Record<string,unknown>}={}){
 await setTenantContext(tx,{companyId:f.company[0],branchId:f.branch[0],actorId:f.actor[0]});
 const [sale]=await tx.select().from(salesEntries).where(eq(salesEntries.id,f.sale[0]));
 const subject={companyId:f.company[0],branchId:f.branch[0],legacySaleId:f.sale[0],recipeId:sale.recipeId,sourceReference:'Corte original 001'};
 const core={schemaVersion:1,...subject,source:'pos:main',productKey:'SKU-01',saleDay:'2026-11-01',quantitySold:'1',totalRevenueCents:null};
 const recipe={schemaVersion:1,kind:'SALE_RECOVERY_RECIPE',...subject,saleDay:'2026-11-01',validFrom:'2026-10-01',validThrough:'2026-11-30',
  recipes:[{id:sale.recipeId,companyId:f.company[0],baseYield:'1',unit:'PORTION',items:[{id:randomUUID(),itemId:f.item[0],quantity:'1',unit:'KG',isSubRecipe:false,yieldPercent:100}]}],
  ingredients:[{id:f.item[0],companyId:f.company[0],unit:'KG'}],conversions:[],...patch.recipe};
 const docs=[{...core,kind:'SALE_RECOVERY_SALE',...patch.sale},recipe,
  {...core,kind:'SALE_RECOVERY_NO_PRIOR_CONSUMPTION',consumptionState:'NOT_APPLIED',basis:{system:'POS',recordReference:'Registro íntegro firmado 001',explanation:'Inventario no aplicado según registro auditado del origen'},...patch.absence}];
 const purposes=['SALE','RECIPE_VERSION','NO_PRIOR_CONSUMPTION'],proofs:string[]=[],facts:string[]=[],objects=new Map<string,Buffer>();
 fakes.read.mockImplementation(async key=>objects.get(key)??null);
 for(let i=0;i<3;i++){
  const proof=randomUUID(),key=`companies/${f.company[0]}/branches/${f.branch[0]}/sales-recovery/${f.sale[0]}/${proof}`;
  await tx.insert(evidence).values({id:proof,companyId:f.company[0],branchId:f.branch[0],entityType:'SALE_RECOVERY',entityId:f.sale[0],url:key,storageKey:key,kind:'FILE',createdBy:f.actor[0],createdAt:new Date('2026-11-01'),updatedAt:sql`'2026-11-01 00:00:00.123456'::timestamp`});
  const bytes=Buffer.from(JSON.stringify(docs[i]));objects.set(key,bytes);proofs.push(proof);
  const fact=await recordRecoveryAttestation({...body(f),evidenceId:proof,purpose:purposes[i],expectedContentSha256:createHash('sha256').update(bytes).digest('hex')});facts.push(fact.id);
 }
 fakes.read.mockClear();
 return{input:{branchId:f.branch[0],legacySaleId:f.sale[0],idempotencyKey:randomUUID(),reason:'Recuperación con fuente original revisada',saleAttestationId:facts[0],recipeAttestationId:facts[1],absenceAttestationId:facts[2]},proofs,objects,recipe,subject};
}
async function proposalCount(tx:Tx){return(await tx.execute(sql`SELECT count(*)::int AS n FROM sale_recovery_proposals`)).rows[0].n;}
describe('expediente preparado desde las tres fuentes en una transacción runtime',()=>{
 beforeAll(async()=>{
  const host=(value:string)=>new URL(value).hostname.replace(/-pooler(?=\.)/,'');expect(host(process.env.TEST_DATABASE_URL!)).toBe('ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech');
  if(existsSync('.env')){const url=parse(readFileSync('.env')).DATABASE_URL;if(url)expect(host(url)).not.toBe(host(process.env.TEST_DATABASE_URL!));}
  expect((await db.execute(sql`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pulso_app'`)).rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
 });
 it('persiste hash/estado/atestaciones exactos y repite sin duplicar; no cambia venta, movimientos ni revisiones',async()=>{
  await probe(async(tx,f)=>{
   const b=await bundle(tx,f),before=await tx.select().from(salesEntries),first=await registerRecoveryProposal(b.input);
   expect(first).toMatchObject({created:true,demand:[{itemId:f.item[0],unit:'KG',quantity:'1.0000'}]});
   expect(await registerRecoveryProposal(b.input)).toEqual({...first,created:false});
   const [stored]=await tx.select().from(saleRecoveryProposals);
   expect(stored.proposal).toMatchObject({schemaVersion:2,requestedBy:f.actor[0],legacy:{id:f.sale[0],totalRevenueCents:null},consumptionState:'NOT_APPLIED',observedHeadId:null,observedMovementIds:[]});
   expect(stored.proposal.evidence.map(p=>p.id).sort()).toEqual(b.proofs.sort());
   expect(stored.proposal.evidence.every(p=>p.evidenceUpdatedAt==='2026-11-01T00:00:00.123456Z')).toBe(true);
   expect(prepareSaleRecoveryReview(stored.proposal)).toMatchObject({proposalHash:first.proposalHash,stateHash:first.stateHash});
   expect(await tx.select().from(salesEntries)).toEqual(before);expect(await tx.select().from(salesConsumptionRevisions)).toEqual([]);
   expect((await tx.execute(sql`SELECT id FROM inventory_movements WHERE branch_id=${f.branch[0]}`)).rows).toEqual([]);
   expect(await proposalCount(tx)).toBe(1);expect(fakes.sign).not.toHaveBeenCalled();
   expect(db.transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'serializable'});
  });
 });
 it('bloquea fuente/producto/día/cobertura divergentes y no persiste propuesta parcial',async()=>{
  await probe(async(tx,f)=>{
   for(const patch of [{absence:{productKey:'SKU-OTHER'}},{absence:{totalRevenueCents:0}},{recipe:{saleDay:'2026-11-02'}}]){
    const b=await bundle(tx,f,patch);await expect(registerRecoveryProposal(b.input)).rejects.toMatchObject({statusCode:409});
   }
   expect(await proposalCount(tx)).toBe(0);
  });
 });
 it('rechaza estado de adjunto obsoleto, objetos alterados y venta modificada sin crear expediente',async()=>{
  await probe(async(tx,f)=>{
   const b=await bundle(tx,f);
   await tx.execute(sql`UPDATE evidence SET updated_at=updated_at+interval '0.000001 second' WHERE id=${b.proofs[0]}`);
   await expect(registerRecoveryProposal(b.input)).rejects.toMatchObject({statusCode:404});expect(fakes.read).not.toHaveBeenCalled();
   const next=await bundle(tx,f);for(const key of next.objects.keys())next.objects.set(key,Buffer.from('changed'));
   await expect(registerRecoveryProposal(next.input)).rejects.toMatchObject({statusCode:409});
   const third=await bundle(tx,f);await tx.execute(sql.raw('RESET ROLE'));await tx.update(salesEntries).set({quantitySold:'2'}).where(eq(salesEntries.id,f.sale[0]));await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
   await expect(registerRecoveryProposal(third.input)).rejects.toMatchObject({statusCode:409});expect(await proposalCount(tx)).toBe(0);
  });
 });
 it('clave repetida no acepta otro motivo, solicitante o versión nativa de venta',async()=>{
  await probe(async(tx,f)=>{
   const b=await bundle(tx,f),first=await registerRecoveryProposal(b.input);
   await expect(registerRecoveryProposal({...b.input,reason:'Motivo distinto'})).rejects.toMatchObject({statusCode:409});
   fakes.auth.mockResolvedValue({user:{id:f.actor[1],role:'ADMIN',companyId:f.company[0]}});
   await expect(registerRecoveryProposal(b.input)).rejects.toMatchObject({statusCode:409});
   fakes.auth.mockResolvedValue({user:{id:f.actor[0],role:'ADMIN',companyId:f.company[0]}});
   const key=[...b.objects.keys()].find(value=>value.endsWith('/'+b.proofs[0]))!;
   const replacement=await recordRecoveryAttestation({...body(f),evidenceId:b.proofs[0],expectedContentSha256:createHash('sha256').update(b.objects.get(key)!).digest('hex')});
   await expect(registerRecoveryProposal({...b.input,saleAttestationId:replacement.id})).rejects.toMatchObject({statusCode:409});
   await tx.execute(sql.raw('RESET ROLE'));await tx.execute(sql`UPDATE sales_entries SET updated_at=updated_at+interval '0.000001 second' WHERE id=${f.sale[0]}`);await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
   await expect(registerRecoveryProposal(b.input)).rejects.toMatchObject({statusCode:409});
   expect(await proposalCount(tx)).toBe(1);expect((await tx.select().from(saleRecoveryProposals))[0].proposalHash).toBe(first.proposalHash);
  });
 });
 it('no transforma movimientos huérfanos, ambiguos o revisiones de proyección en consumo cero',async()=>{
  await probe(async(tx,f)=>{
   const b=await bundle(tx,f);
   const [identity]=await tx.insert(salesConsumptionIdentities).values({companyId:f.company[0],branchId:f.branch[0],saleDay:'2026-11-01',source:'pos:main',productKey:'SKU-01'}).returning();
   await tx.execute(sql`INSERT INTO inventory_movements (branch_id,item_id,type,quantity_change,reference_id,performed_by)
    VALUES (${f.branch[0]},${f.item[0]},'USAGE',-1,${'salecons:'+identity.id},${f.actor[0]})`);
   await expect(registerRecoveryProposal(b.input)).rejects.toMatchObject({statusCode:409});
   await tx.execute(sql.raw('RESET ROLE'));await tx.execute(sql`DELETE FROM inventory_movements WHERE branch_id=${f.branch[0]}`);await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
   await tx.execute(sql`INSERT INTO inventory_movements (branch_id,item_id,type,quantity_change,performed_by) VALUES (${f.branch[0]},${f.item[0]},'USAGE',-1,${f.actor[0]})`);
   await expect(registerRecoveryProposal(b.input)).rejects.toMatchObject({statusCode:409});
   const historical=await decodeRecoveryHistoricalRecipe(Buffer.from(JSON.stringify(b.recipe)),b.subject);
   await tx.insert(salesConsumptionRevisions).values({identityId:identity.id,companyId:f.company[0],branchId:f.branch[0],revision:1,previousRevision:null,previousQuantitySold:'0',quantitySold:'1',totalRevenue:null,recipeId:b.recipe.recipeId,recipeSnapshot:historical.recipeSnapshot,allocations:[],movementRefs:[],recordedBy:f.actor[0]});
   await expect(registerRecoveryProposal(b.input)).rejects.toMatchObject({statusCode:409,message:'La venta o proyección ya tiene revisiones; requiere otra recuperación'});
   expect(await proposalCount(tx)).toBe(0);
  });
 });
 it('cantidades cero no ocultan movimientos ambiguos de ingredientes históricos',async()=>{
  await probe(async(tx,f)=>{
   await tx.execute(sql.raw('RESET ROLE'));await tx.update(salesEntries).set({quantitySold:'0'}).where(eq(salesEntries.id,f.sale[0]));await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
   const b=await bundle(tx,f,{sale:{quantitySold:'0'},absence:{quantitySold:'0'}});
   await tx.execute(sql`INSERT INTO inventory_movements (branch_id,item_id,type,quantity_change,performed_by) VALUES (${f.branch[0]},${f.item[0]},'USAGE',-1,${f.actor[0]})`);
   await expect(registerRecoveryProposal(b.input)).rejects.toMatchObject({statusCode:409,message:'Existen movimientos previos o sin atribución; no se demuestra consumo cero'});
   expect(await proposalCount(tx)).toBe(0);
  });
 });
 it('fallo después del INSERT revierte el expediente aunque el llamador capture el error',async()=>{
  await probe(async(tx,f)=>{
   const b=await bundle(tx,f);await tx.execute(sql.raw('RESET ROLE'));
   await tx.execute(sql.raw(`CREATE FUNCTION pg_temp.reject_recovery_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic post-insert failure' USING ERRCODE='23514'; END $$`));
   await tx.execute(sql.raw('CREATE TRIGGER recovery_fixture_reject AFTER INSERT ON sale_recovery_proposals FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_recovery_insert()'));
   await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
   await expect(registerRecoveryProposal(b.input)).rejects.toMatchObject({statusCode:500,message:'No fue posible preparar el expediente de recuperación'});
   expect(await proposalCount(tx)).toBe(0);expect(await count(tx,f)).toBe(3);
  });
 });
 it('otra empresa/sucursal/venta y declaraciones de autoridad ajenas fallan sin acceder a R2',async()=>{
  await probe(async(tx,f)=>{
   const b=await bundle(tx,f);
   await expect(registerRecoveryProposal({...b.input,legacySaleId:f.sale[1]})).rejects.toMatchObject({statusCode:404});
   await expect(registerRecoveryProposal({...b.input,branchId:f.branch[1]})).rejects.toMatchObject({statusCode:404});
   fakes.auth.mockResolvedValue({user:{id:f.actor[2],role:'ADMIN',companyId:f.company[1]}});
   await expect(registerRecoveryProposal(b.input)).rejects.toMatchObject({statusCode:404});expect(fakes.read).not.toHaveBeenCalled();
   expect(await count(tx,f)).toBe(3);
  });
 });
});


