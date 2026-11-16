import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { branches, recipes, salesEntries, evidence, saleRecoveryAttestations as attestations } from '@/lib/db/schema';
import { requireAuth } from '@/lib/tenant-context';
import { withCompanyContext } from '@/lib/db/tenant-context';
import { resolveBranchScope } from '@/lib/branch-scope';
import { hasPermission } from '@/lib/permissions';
import { ApiError, isApiError } from '@/lib/api/error';
import { getFromR2, isR2Configured } from '@/lib/storage/r2-client';
import { soldQuantity } from './sale-consumption-contract';
import { decodeRecoverySourceDocument, MAX_RECOVERY_SOURCE_BYTES } from './sale-recovery-source-documents';
import { SaleRecoveryReviewError } from './sale-recovery-review';
import type { db } from '@/lib/db';

type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];

const uuid=z.string().uuid().toLowerCase();
const request=z.object({branchId:uuid,legacySaleId:uuid,attestationId:uuid,purpose:z.enum(['SALE','NO_PRIOR_CONSUMPTION'])}).strict();

/** Lector interno sin DML. Una declaración atestiguada no demuestra por sí sola consumo cero. */
export async function readRecoverySourceDocument(input:unknown){
 const {user}=await requireAuth();
 if(!user||typeof user.id!=='string'||!user.id.trim()||user.id!==user.id.trim()||user.id.length>256
  ||!uuid.safeParse(user.companyId).success||!['ADMIN','OWNER','SUPER_ADMIN'].includes(user.role)||!hasPermission(user.role,'inventory','manage'))
  throw ApiError.forbidden('Las fuentes históricas requieren una sesión administrativa de la empresa');
 const parsed=request.safeParse(input);if(!parsed.success)throw ApiError.badRequest('Referencia de fuente histórica inválida');
 const data=parsed.data,companyId=uuid.parse(user.companyId),actorId=user.id;
 const scope=resolveBranchScope(user.role,user.branchId?.toLowerCase()??null,data.branchId);
 if(scope.kind!=='BRANCH'||scope.branchId!==data.branchId)throw ApiError.forbidden('Sucursal fuera del alcance autorizado');
 if(!isR2Configured())throw new ApiError('Almacenamiento privado no disponible',503);
 return withCompanyContext({companyId,branchId:data.branchId,actorId},async q=>{
  const {bytes,row,proof}=await loadRecoveryDocumentInTransaction(q,{companyId,branchId:data.branchId},data);
  try{
   const document=decodeRecoverySourceDocument(bytes,{companyId,branchId:data.branchId,legacySaleId:data.legacySaleId,recipeId:row.recipeId,sourceReference:row.sourceReference},data.purpose);
   if(document.quantitySold!==soldQuantity(row.quantitySold))throw ApiError.conflict('La cantidad documental no coincide con la venta legada');
   return{document,evidence:proof};
  }catch(error){if(error instanceof SaleRecoveryReviewError)throw ApiError.conflict(error.message);throw error;}
 }).catch(error=>{
  if(isApiError(error))throw error;
  throw ApiError.internal('No fue posible cargar la fuente histórica');
 });
}

/** Interno: exige transacción y alcance ya autorizados por la fachada; nunca recibe DB/actor por HTTP. */
export async function loadRecoveryDocumentInTransaction(q:Tx,scope:{companyId:string;branchId:string},
 input:{legacySaleId:string;attestationId:string;purpose:'SALE'|'RECIPE_VERSION'|'NO_PRIOR_CONSUMPTION'}){
  const {companyId}=scope,data={...input,branchId:scope.branchId};
  const [row]=await q.select({id:evidence.id,attestationId:attestations.id,companyId:attestations.companyId,branchId:attestations.branchId,
   legacySaleId:attestations.legacySaleId,purpose:attestations.purpose,storageKey:evidence.storageKey,
   contentSha256:attestations.contentSha256,byteLength:attestations.byteLength,sourceReference:attestations.sourceReference,
   verificationReason:attestations.reason,verifiedBy:attestations.verifiedBy,verifiedRole:attestations.verifiedRole,
   createdAt:sql<string>`to_char(${evidence.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
   evidenceUpdatedAt:sql<string>`to_char(${evidence.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
   verifiedAt:sql<string>`to_char(${attestations.verifiedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
   recipeId:salesEntries.recipeId,quantitySold:salesEntries.quantitySold})
   .from(attestations).innerJoin(evidence,and(eq(evidence.id,attestations.evidenceId),eq(evidence.companyId,attestations.companyId),eq(evidence.branchId,attestations.branchId),eq(evidence.entityId,sql`${attestations.legacySaleId}::text`)))
   .innerJoin(salesEntries,and(eq(salesEntries.id,attestations.legacySaleId),eq(salesEntries.companyId,attestations.companyId),eq(salesEntries.branchId,attestations.branchId)))
   .innerJoin(branches,and(eq(branches.id,salesEntries.branchId),eq(branches.companyId,salesEntries.companyId)))
   .innerJoin(recipes,and(eq(recipes.id,salesEntries.recipeId),eq(recipes.companyId,salesEntries.companyId)))
   .where(and(eq(attestations.id,data.attestationId),eq(attestations.companyId,companyId),eq(attestations.branchId,data.branchId),eq(attestations.legacySaleId,data.legacySaleId),
    eq(attestations.purpose,data.purpose),eq(evidence.entityType,'SALE_RECOVERY'),isNull(evidence.deletedAt),eq(attestations.storageKey,evidence.storageKey),
    eq(attestations.evidenceUpdatedAt,evidence.updatedAt),sql`${attestations.verifiedAt} <= clock_timestamp()`,
    sql`${attestations.verifiedAt} >= ${evidence.updatedAt} AT TIME ZONE 'UTC'`,sql`${evidence.updatedAt} >= ${evidence.createdAt}`))
   .for('share',{of:[evidence,salesEntries]});
  const key=row?`companies/${companyId}/branches/${data.branchId}/sales-recovery/${data.legacySaleId}/${row.id}`:null;
  if(!row||row.storageKey!==key)throw ApiError.notFound('Atestación fuente vigente no encontrada');
  if(row.byteLength>MAX_RECOVERY_SOURCE_BYTES)throw ApiError.conflict('El documento fuente excede 2 MiB');
  let bytes:Buffer|null;
  try{bytes=await getFromR2(row.storageKey,{maxBytes:MAX_RECOVERY_SOURCE_BYTES,timeoutMs:15000});}
  catch{throw new ApiError('No fue posible comprobar el documento fuente',502);}
  if(!bytes?.length||bytes.length!==row.byteLength||bytes.length>MAX_RECOVERY_SOURCE_BYTES||createHash('sha256').update(bytes).digest('hex')!==row.contentSha256)
   throw ApiError.conflict('El documento fuente está ausente o cambió desde su revisión');
   return{bytes,row,proof:{id:row.id,attestationId:row.attestationId,companyId:row.companyId,branchId:row.branchId,
    legacySaleId:row.legacySaleId,purpose:data.purpose,storageKey:row.storageKey,contentSha256:row.contentSha256,
    byteLength:row.byteLength,sourceReference:row.sourceReference,verificationReason:row.verificationReason,
    verifiedBy:row.verifiedBy,verifiedRole:row.verifiedRole,createdAt:row.createdAt,evidenceUpdatedAt:row.evidenceUpdatedAt,
    verifiedAt:row.verifiedAt,deletedAt:null}};
}
