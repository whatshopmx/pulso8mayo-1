import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { buildSaleRecipeSnapshot } from '@/lib/services/sale-consumption-snapshot';
import { prepareSaleRecoveryReview, assertRecoveryReviewMatches } from '@/lib/services/sale-recovery-review';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const recipeSnapshot=await buildSaleRecipeSnapshot(id(1),id(4),{
  recipe:async()=>({id:id(4),companyId:id(1),baseYield:'1',unit:'PORTION',items:[{id:id(8),itemId:id(9),quantity:'0.25',unit:'KG',isSubRecipe:false,yieldPercent:100}]}),
  ingredient:async()=>({id:id(9),companyId:id(1),unit:'KG'}),conversions:async()=>[],
 });
 const native=(await db.execute<{earlier:string;later:string}>(sql`SELECT
  to_char('2026-11-02 00:00:00.123456'::timestamp,'YYYY-MM-DD"T"HH24:MI:SS.US')||'Z' AS earlier,
  to_char('2026-11-02 00:00:00.123456'::timestamp+interval '0.000001 second','YYYY-MM-DD"T"HH24:MI:SS.US')||'Z' AS later`)).rows[0];
 const input={schemaVersion:2,idempotencyKey:id(10),requestedBy:'synthetic-requester',reason:'Revisar archivo histórico completo',
  identity:{companyId:id(1),branchId:id(2),source:'pos:historical',productKey:'SKU-1',saleDay:'2026-11-01'},
  legacy:{id:id(3),companyId:id(1),branchId:id(2),recipeId:id(4),saleDay:'2026-11-01',quantitySold:'2.00',totalRevenueCents:null,updatedAt:native.earlier},
  observedHeadId:null,observedMovementIds:[],consumptionState:'NOT_APPLIED',recipeSnapshot,
  evidence:['SALE','RECIPE_VERSION','NO_PRIOR_CONSUMPTION'].map((purpose,i)=>({id:id(20+i),attestationId:id(30+i),companyId:id(1),branchId:id(2),legacySaleId:id(3),purpose,
   storageKey:`companies/${id(1)}/branches/${id(2)}/sales-recovery/${id(3)}/${id(20+i)}`,contentSha256:'a'.repeat(64),byteLength:100,
   sourceReference:'Archivo original',verificationReason:'Revisión documental',verifiedBy:'synthetic-verifier',verifiedRole:'ADMIN',
   createdAt:'2026-11-01T00:00:00Z',evidenceUpdatedAt:native.earlier,verifiedAt:'2026-11-03T00:00:00Z',deletedAt:null})),
 };
 return{input,native};
}
describe('precisión del expediente con timestamps/JSONB PostgreSQL reales, sin DDL/DML',()=>{
 beforeAll(()=>{
  const host=(value:string)=>new URL(value).hostname.replace(/-pooler(?=\.)/,'');expect(host(process.env.TEST_DATABASE_URL!)).toBe('ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech');
  if(existsSync('.env')){const url=parse(readFileSync('.env')).DATABASE_URL;if(url)expect(host(url)).not.toBe(host(process.env.TEST_DATABASE_URL!));}
 });
 it('JSONB conserva el DTO v2 y su huella con seis dígitos nativos',async()=>{
  const {input,native}=await fixture(),prepared=prepareSaleRecoveryReview(input);
  const [{proposal}]=(await db.execute<{proposal:unknown}>(sql`SELECT ${JSON.stringify(prepared.proposal)}::jsonb AS proposal`)).rows;
  expect(native).toEqual({earlier:'2026-11-02T00:00:00.123456Z',later:'2026-11-02T00:00:00.123457Z'});
  expect(prepareSaleRecoveryReview(proposal)).toEqual(prepared);
 });
 it('un microsegundo nativo de venta o evidencia cambia estado/propuesta',async()=>{
  const {input,native}=await fixture(),prepared=prepareSaleRecoveryReview(input);
  for(const changed of [{...input,legacy:{...input.legacy,updatedAt:native.later}},
   {...input,evidence:[{...input.evidence[0],evidenceUpdatedAt:native.later},...input.evidence.slice(1)]}]){
   const current=prepareSaleRecoveryReview(changed);expect(current.stateHash).not.toBe(prepared.stateHash);expect(current.proposalHash).not.toBe(prepared.proposalHash);
  }
 });
 it('el revisor no puede aprobar un microsegundo antes de la atestación nativa',async()=>{
  const {input,native}=await fixture();input.evidence=input.evidence.map(proof=>({...proof,verifiedAt:native.later}));
  const prepared=prepareSaleRecoveryReview(input),approval={companyId:id(1),branchId:id(2),proposalHash:prepared.proposalHash,stateHash:prepared.stateHash,decision:'APPROVED',approvedBy:'synthetic-reviewer',approverRole:'ADMIN',approvedAt:native.earlier};
  expect(()=>assertRecoveryReviewMatches(prepared,approval,input)).toThrow(/precede/i);
  expect(()=>assertRecoveryReviewMatches(prepared,{...approval,approvedAt:native.later},input)).not.toThrow();
 });
});
