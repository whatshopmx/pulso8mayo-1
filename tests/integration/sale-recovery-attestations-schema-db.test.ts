import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, recipes, salesEntries, evidence, users } from "@/lib/db/schema";

type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture={company:string[];branch:string[];sale:string[];proof:string[];actor:string};
const migration='drizzle/0145_inv01c_recovery_attestations.sql';
async function context(tx:Tx,f:Fixture,company=f.company[0],branch=f.branch[0],actor=f.actor){
  await tx.execute(sql`SELECT set_config('app.current_company_id',${company},true),set_config('app.current_branch_id',${branch},true),set_config('app.current_actor_id',${actor},true)`);
}
async function rejected(tx:Tx,code:string,work:()=>Promise<unknown>){
  await tx.execute(sql.raw('SAVEPOINT attestation_rejected'));let actual:string|undefined;
  try{await work();}catch(error){const e=error as {code?:string;cause?:{code?:string}};actual=e.cause?.code??e.code;}
  await tx.execute(sql.raw('ROLLBACK TO SAVEPOINT attestation_rejected'));expect(actual).toBe(code);
}
type Changes={company?:string;branch?:string;sale?:string;proof?:string;key?:string;purpose?:string;hash?:string;length?:number;actor?:string;role?:string;reference?:string;reason?:string;changed?:boolean;at?:string;storageKey?:string};
async function attest(tx:Tx,f:Fixture,c:Changes={}){
  return tx.execute(sql`INSERT INTO sale_recovery_attestations
    (company_id,branch_id,legacy_sale_id,evidence_id,idempotency_key,purpose,storage_key,evidence_updated_at,content_sha256,byte_length,source_reference,reason,verified_by,verified_role,verified_at)
    SELECT ${c.company??f.company[0]}::uuid,${c.branch??f.branch[0]}::uuid,${c.sale??f.sale[0]}::uuid,e.id,${c.key??randomUUID()}::uuid,
      ${c.purpose??'SALE'},coalesce(${c.storageKey??null},e.storage_key),e.updated_at + ${c.changed?'1 second':'0 seconds'}::interval,
      ${c.hash??'a'.repeat(64)},${c.length??100},${c.reference??'Documento/corte original sintético'},${c.reason??'Revisión documental registrada por servidor'},
      ${c.actor??f.actor},${c.role??'ADMIN'},coalesce(${c.at??null}::timestamptz,clock_timestamp())
    FROM evidence e WHERE e.id=${c.proof??f.proof[0]} RETURNING id,purpose,content_sha256,byte_length`);
}
async function probe(work:(tx:Tx,f:Fixture)=>Promise<void>){
  const ids=(n:number)=>Array.from({length:n},()=>randomUUID());const f={company:ids(2),branch:ids(3),sale:ids(3),proof:ids(3),actor:randomUUID()};
  await db.transaction(async tx=>{
    for(const statement of readFileSync(migration,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await tx.execute(sql.raw(statement));
    await tx.insert(companies).values(f.company.map(id=>({id,name:'Attestation synthetic'})));
    await tx.insert(branches).values(f.branch.map((id,i)=>({id,companyId:f.company[i===2?1:0],name:'Attestation branch'})));
    const recipe=ids(2);await tx.insert(recipes).values(recipe.map((id,i)=>({id,companyId:f.company[i],name:'Synthetic recipe'})));
    await tx.insert(salesEntries).values(f.sale.map((id,i)=>({id,companyId:f.company[i===2?1:0],branchId:f.branch[i],recipeId:recipe[i===2?1:0],quantitySold:'1',saleDate:new Date('2026-11-01'),totalRevenue:0})));
    await tx.insert(users).values({id:f.actor,name:'Synthetic verifier',email:`${f.actor}@attestation.test`,emailVerified:false,createdAt:new Date(),updatedAt:new Date(),role:'ADMIN',companyId:f.company[0]});
    await tx.insert(evidence).values(f.proof.map((id,i)=>{const companyId=f.company[i===2?1:0],branchId=f.branch[i],sale=f.sale[i],key=`companies/${companyId}/branches/${branchId}/sales-recovery/${sale}/${id}`;return{id,companyId,branchId,entityType:'SALE_RECOVERY' as const,entityId:sale,kind:'FILE' as const,url:key,storageKey:key};}));
    await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));await context(tx,f);await work(tx,f);
    throw new Error('attestations schema rollback esperado');
  }).catch(error=>{if(!(error instanceof Error)||error.message!=='attestations schema rollback esperado')throw error;});
  expect((await db.execute(sql`SELECT to_regclass('public.sale_recovery_attestations') AS relation`)).rows[0].relation).toBeNull();
  for(const id of f.company)expect((await db.execute(sql`SELECT id FROM companies WHERE id=${id}`)).rows).toEqual([]);
}
describe('atestaciones de recuperación: contrato SQL aislado, sin verificación de objetos ni autoridad operativa',()=>{
  beforeAll(async()=>{
    expect(existsSync(migration)).toBe(true);
    const host=(value:string)=>new URL(value).hostname.replace(/-pooler(?=\.)/,'');
    expect(host(process.env.TEST_DATABASE_URL!)).toBe('ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech');
    if(existsSync('.env')){const operational=parse(readFileSync('.env')).DATABASE_URL;if(operational)expect(host(operational)).not.toBe(host(process.env.TEST_DATABASE_URL!));}
    expect((await db.execute(sql`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pulso_app'`)).rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
  });
  it('conserva las tres finalidades y el estado observado exacto sin truncar microsegundos',async()=>{
    await probe(async(tx,f)=>{
      for(const purpose of ['SALE','RECIPE_VERSION','NO_PRIOR_CONSUMPTION'])expect((await attest(tx,f,{purpose})).rows[0]).toMatchObject({purpose,content_sha256:'a'.repeat(64),byte_length:100});
      expect((await tx.execute(sql`SELECT count(*)::int AS n FROM sale_recovery_attestations a JOIN evidence e ON e.id=a.evidence_id WHERE a.evidence_updated_at=e.updated_at`)).rows[0].n).toBe(3);
    });
  });
  it('RLS forzada sin contexto no lee; empresa y sucursal acotan consultas sin WHERE',async()=>{
    await probe(async(tx,f)=>{
      await attest(tx,f);await context(tx,f,f.company[0],f.branch[1]);await attest(tx,f,{branch:f.branch[1],sale:f.sale[1],proof:f.proof[1]});
      await context(tx,f,'','','');expect((await tx.execute(sql`SELECT id FROM sale_recovery_attestations`)).rows).toEqual([]);
      await context(tx,f);expect((await tx.execute(sql`SELECT id FROM sale_recovery_attestations`)).rows).toHaveLength(1);
      await context(tx,f,f.company[0],'');expect((await tx.execute(sql`SELECT id FROM sale_recovery_attestations`)).rows).toHaveLength(2);
      await context(tx,f,f.company[1],f.branch[2]);expect((await tx.execute(sql`SELECT id FROM sale_recovery_attestations`)).rows).toEqual([]);
      expect((await tx.execute(sql`SELECT relrowsecurity AS rls,relforcerowsecurity AS force FROM pg_class WHERE oid='sale_recovery_attestations'::regclass`)).rows[0]).toEqual({rls:true,force:true});
    });
  });
  it('falta de actor, sucursal/venta lateral, GENERAL, baja y estado cambiado no permiten atestación',async()=>{
    await probe(async(tx,f)=>{
      await context(tx,f,f.company[0],f.branch[0],'');await rejected(tx,'42501',()=>attest(tx,f));await context(tx,f);
      await rejected(tx,'42501',()=>attest(tx,f,{actor:'spoofed'}));
      await rejected(tx,'42501',()=>attest(tx,f,{company:f.company[1]}));
      await rejected(tx,'42501',()=>attest(tx,f,{branch:f.branch[1]}));
      await rejected(tx,'42501',()=>attest(tx,f,{sale:f.sale[1]}));
      await rejected(tx,'42501',()=>attest(tx,f,{changed:true}));
      await rejected(tx,'42501',()=>attest(tx,f,{storageKey:'https://example.test/not-an-object'}));
      await attest(tx,f);
      await tx.execute(sql`UPDATE evidence SET entity_type='GENERAL' WHERE id=${f.proof[0]}`);await rejected(tx,'42501',()=>attest(tx,f));
      await tx.execute(sql`UPDATE evidence SET entity_type='SALE_RECOVERY',deleted_at=now() WHERE id=${f.proof[0]}`);await rejected(tx,'42501',()=>attest(tx,f));
      expect((await tx.execute(sql`SELECT id FROM sale_recovery_attestations`)).rows).toHaveLength(1); // Conserva el hecho histórico, no habilita su uso con evidencia retirada.
    });
  });
  it('rechaza claims malformados, tamaño/hash fuera de rango, fecha anterior e idempotencia duplicada',async()=>{
    await probe(async(tx,f)=>{
      for(const change of [{purpose:'UNKNOWN'},{role:'GERENTE'},{hash:'fake'},{length:0},{length:20971521},{reference:' '},{reason:' '},{at:'infinity'}])await rejected(tx,'23514',()=>attest(tx,f,change));
      await rejected(tx,'42501',()=>attest(tx,f,{at:'2020-01-01T00:00:00Z'}));
      const key=randomUUID();await attest(tx,f,{key});await rejected(tx,'23505',()=>attest(tx,f,{key}));
    });
  });
  it('no amplía privilegios a UPDATE/DELETE/TRUNCATE y protege también frente al dueño',async()=>{
    await probe(async(tx,f)=>{
      await attest(tx,f);
      expect((await tx.execute(sql`SELECT has_table_privilege(current_user,'sale_recovery_attestations','SELECT') AS read,has_table_privilege(current_user,'sale_recovery_attestations','INSERT') AS insert,has_table_privilege(current_user,'sale_recovery_attestations','UPDATE,DELETE,TRUNCATE') AS rewrite`)).rows[0]).toEqual({read:true,insert:true,rewrite:false});
      await rejected(tx,'42501',()=>tx.execute(sql`UPDATE sale_recovery_attestations SET purpose='RECIPE_VERSION'`));
      await rejected(tx,'42501',()=>tx.execute(sql`DELETE FROM sale_recovery_attestations`));
      await tx.execute(sql.raw('RESET ROLE'));
      await rejected(tx,'23514',()=>tx.execute(sql`UPDATE sale_recovery_attestations SET purpose='RECIPE_VERSION'`));
      await rejected(tx,'23514',()=>tx.execute(sql`DELETE FROM sale_recovery_attestations`));
    });
  });
});
