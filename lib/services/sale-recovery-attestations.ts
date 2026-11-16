import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { branches, evidence, salesEntries, saleRecoveryAttestations as attestations } from '@/lib/db/schema';
import { requireAuth } from '@/lib/tenant-context';
import { withCompanyContext } from '@/lib/db/tenant-context';
import { hasPermission } from '@/lib/permissions';
import { ApiError, isApiError } from '@/lib/api/error';
import { resolveBranchScope } from '@/lib/branch-scope';
import { getFromR2, generatePresignedUrl, isR2Configured } from '@/lib/storage/r2-client';
import { EVIDENCE_URL_TTL_SECONDS } from '@/lib/storage/scoped-evidence';
import type { DbExecutor } from './fefo-allocator';

const uuid=z.string().uuid().toLowerCase(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const ref=z.object({branchId:uuid,evidenceId:uuid}).strict();
const request=ref.extend({legacySaleId:uuid,idempotencyKey:uuid,purpose:z.enum(['SALE','RECIPE_VERSION','NO_PRIOR_CONSUMPTION']),
  sourceReference:z.string().trim().min(1).max(2000),reason:z.string().trim().min(1).max(2000),expectedContentSha256:hash}).strict();
type RequestData=z.infer<typeof request>;
type Scope={companyId:string;branchId:string;actorId:string};
function parse<T>(schema:z.ZodType<T>,input:unknown):T{const result=schema.safeParse(input);if(!result.success)throw ApiError.badRequest('Datos de atestación inválidos');return result.data;}
async function actor(){
  const {user}=await requireAuth();
  if(!user||typeof user.id!=='string'||!user.id.trim()||user.id!==user.id.trim()||user.id.length>256
    ||!['ADMIN','OWNER','SUPER_ADMIN'].includes(user.role)||!hasPermission(user.role,'inventory','manage')||!uuid.safeParse(user.companyId).success)
    throw ApiError.forbidden('La atestación requiere una sesión administrativa de la empresa');
  return{id:user.id,role:user.role,companyId:uuid.parse(user.companyId),branchId:typeof user.branchId==='string'?user.branchId.toLowerCase():null};
}
function scopeFor(user:Awaited<ReturnType<typeof actor>>,branchId:string):Scope{
  const scope=resolveBranchScope(user.role,user.branchId,branchId);
  if(scope.kind!=='BRANCH'||scope.branchId!==branchId)throw ApiError.forbidden('Sucursal fuera del alcance autorizado');
  return{companyId:user.companyId,branchId,actorId:user.id};
}
function registrationFailure(error:unknown):never{
  if(isApiError(error))throw error;
  const failure=error as {code?:unknown;cause?:{code?:unknown}};
  const code=failure?.cause?.code??failure?.code;
  console.error('[sale-recovery-attestation] Database operation failed',{code:typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?code:'UNKNOWN'});
  throw ApiError.internal('No fue posible registrar la atestación');
}
function storage(){if(!isR2Configured())throw new ApiError('Almacenamiento privado no disponible',503);}
async function readObject(q:DbExecutor,scope:Scope,id:string,expectedSaleId?:string){
  const [row]=await q.select({id:evidence.id,legacySaleId:salesEntries.id,key:evidence.storageKey,version:sql<string>`${evidence.updatedAt}::text`})
    .from(evidence).innerJoin(salesEntries,and(eq(evidence.entityId,sql`${salesEntries.id}::text`),eq(evidence.companyId,salesEntries.companyId),eq(evidence.branchId,salesEntries.branchId)))
    .innerJoin(branches,and(eq(branches.id,salesEntries.branchId),eq(branches.companyId,salesEntries.companyId)))
    .where(and(eq(evidence.id,id),eq(evidence.entityType,'SALE_RECOVERY'),eq(evidence.companyId,scope.companyId),eq(evidence.branchId,scope.branchId),isNull(evidence.deletedAt),
      sql`clock_timestamp() >= ${evidence.createdAt} AT TIME ZONE 'UTC' AND clock_timestamp() >= ${evidence.updatedAt} AT TIME ZONE 'UTC'`)).for('share',{of:evidence});
  if(!row||row.key!==`companies/${scope.companyId}/branches/${scope.branchId}/sales-recovery/${row.legacySaleId}/${id}`)throw ApiError.notFound('Evidencia privada no encontrada');
  if(expectedSaleId!==undefined&&row.legacySaleId!==expectedSaleId)throw ApiError.conflict('El sujeto de la evidencia cambió; abre de nuevo el documento');
  let bytes:Buffer|null;
  try{bytes=await getFromR2(row.key,{maxBytes:20*1024*1024,timeoutMs:15000});}
  catch{throw new ApiError('No fue posible comprobar el objeto privado',502);}
  if(!bytes?.byteLength||bytes.byteLength>20*1024*1024)throw ApiError.conflict('El objeto privado no está disponible para verificar');
  return{...row,contentSha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.byteLength};
}
async function find(q:DbExecutor,scope:Scope,key:string){
  const [row]=await q.select({fact:attestations,version:sql<string>`${attestations.evidenceUpdatedAt}::text`}).from(attestations)
    .where(and(eq(attestations.companyId,scope.companyId),eq(attestations.branchId,scope.branchId),eq(attestations.idempotencyKey,key)));
  return row;
}
function sameRequest(fact:typeof attestations.$inferSelect,data:RequestData,scope:Scope){
  if(fact.evidenceId!==data.evidenceId||fact.legacySaleId!==data.legacySaleId||fact.purpose!==data.purpose||fact.sourceReference!==data.sourceReference||fact.reason!==data.reason
    ||fact.verifiedBy!==scope.actorId||fact.contentSha256!==data.expectedContentSha256)throw ApiError.conflict('La clave idempotente corresponde a otra atestación');
}
function publicFact(fact:typeof attestations.$inferSelect){return{id:fact.id,evidenceId:fact.evidenceId,legacySaleId:fact.legacySaleId,branchId:fact.branchId,
  purpose:fact.purpose,contentSha256:fact.contentSha256,byteLength:fact.byteLength,sourceReference:fact.sourceReference,reason:fact.reason,
  verifiedBy:fact.verifiedBy,verifiedRole:fact.verifiedRole,verifiedAt:fact.verifiedAt};}

/** Preview no persiste ni atestigua: muestra exactamente los bytes que deberán revisarse. */
export async function previewRecoveryAttestation(input:unknown){
  const user=await actor(),data=parse(ref,input),scope=scopeFor(user,data.branchId);storage();
  return withCompanyContext(scope,async q=>{
    const source=await readObject(q,scope,data.evidenceId);let url:string;
    try{url=await generatePresignedUrl(source.key,EVIDENCE_URL_TTL_SECONDS);}catch{throw new ApiError('No fue posible abrir la evidencia',502);}
    return{evidenceId:source.id,legacySaleId:source.legacySaleId,branchId:scope.branchId,contentSha256:source.contentSha256,byteLength:source.byteLength,url};
  });
}
/** Certifica revisión documental y lectura de bytes por un actor, nunca una aprobación de stock. */
export async function recordRecoveryAttestation(input:unknown){
  const user=await actor(),data=parse(request,input),scope=scopeFor(user,data.branchId);storage();
  return withCompanyContext(scope,async q=>{
    const existing=await find(q,scope,data.idempotencyKey);if(existing)sameRequest(existing.fact,data,scope);
    const source=await readObject(q,scope,data.evidenceId,data.legacySaleId);
    if(source.contentSha256!==data.expectedContentSha256)throw ApiError.conflict('El contenido cambió desde la revisión; abre de nuevo la evidencia');
    if(existing){
      if(existing.version!==source.version||existing.fact.storageKey!==source.key||existing.fact.byteLength!==source.byteLength)throw ApiError.conflict('El estado del adjunto cambió; requiere otra atestación');
      return{...publicFact(existing.fact),created:false};
    }
    // INSERT SELECT conserva los microsegundos nativos y vuelve a comprobar el sujeto incluso con conexión dueña.
    const inserted=await q.execute<{id:string}>(sql`INSERT INTO public.sale_recovery_attestations
      (company_id,branch_id,legacy_sale_id,evidence_id,idempotency_key,purpose,storage_key,evidence_updated_at,content_sha256,byte_length,source_reference,reason,verified_by,verified_role)
      SELECT e.company_id,e.branch_id,s.id,e.id,${data.idempotencyKey}::uuid,${data.purpose},e.storage_key,e.updated_at,
        ${source.contentSha256},${source.byteLength},${data.sourceReference},${data.reason},${scope.actorId},${user.role}
      FROM public.evidence e JOIN public.sales_entries s ON s.id::text=e.entity_id AND s.company_id=e.company_id AND s.branch_id=e.branch_id
      JOIN public.branches b ON b.id=s.branch_id AND b.company_id=s.company_id
      WHERE e.id=${data.evidenceId} AND s.id=${data.legacySaleId}::uuid AND e.company_id=${scope.companyId} AND e.branch_id=${scope.branchId} AND e.entity_type='SALE_RECOVERY'
        AND e.deleted_at IS NULL AND e.storage_key=${source.key} AND e.updated_at::text=${source.version}
        AND clock_timestamp() >= e.created_at AT TIME ZONE 'UTC' AND clock_timestamp() >= e.updated_at AT TIME ZONE 'UTC'
      ON CONFLICT (company_id,idempotency_key) DO NOTHING RETURNING id`);
    const stored=await find(q,scope,data.idempotencyKey);
    if(!stored)throw ApiError.conflict('La atestación no pudo registrarse con ese estado y clave');
    sameRequest(stored.fact,data,scope);
    if(stored.version!==source.version||stored.fact.storageKey!==source.key||stored.fact.byteLength!==source.byteLength)throw ApiError.conflict('El estado del adjunto cambió; requiere otra atestación');
    return{...publicFact(stored.fact),created:inserted.rows.length===1};
  }).catch(registrationFailure);
}
