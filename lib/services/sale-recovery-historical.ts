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
import { decodeRecoveryHistoricalRecipe, MAX_HISTORICAL_RECIPE_BYTES } from './sale-recovery-historical-recipe';
import { SaleRecoveryReviewError } from './sale-recovery-review';

const uuid=z.string().uuid().toLowerCase();
const request=z.object({branchId:uuid,legacySaleId:uuid,attestationId:uuid}).strict();

/** Lectura administrativa sin DML. El expediente posterior debe contrastar día/vigencia con la fuente SALE. */
export async function readRecoveryHistoricalRecipe(input:unknown){
 const {user}=await requireAuth();
 if(!user||typeof user.id!=='string'||!user.id.trim()||user.id!==user.id.trim()||user.id.length>256
  ||!uuid.safeParse(user.companyId).success||!['ADMIN','OWNER','SUPER_ADMIN'].includes(user.role)||!hasPermission(user.role,'inventory','manage'))
  throw ApiError.forbidden('La receta histórica requiere una sesión administrativa de la empresa');
 const parsed=request.safeParse(input);if(!parsed.success)throw ApiError.badRequest('Referencia histórica inválida');
 const data=parsed.data,companyId=uuid.parse(user.companyId),actorId=user.id;
 const scope=resolveBranchScope(user.role,user.branchId?.toLowerCase()??null,data.branchId);
 if(scope.kind!=='BRANCH'||scope.branchId!==data.branchId)throw ApiError.forbidden('Sucursal fuera del alcance autorizado');
 if(!isR2Configured())throw new ApiError('Almacenamiento privado no disponible',503);
 return withCompanyContext({companyId,branchId:data.branchId,actorId},async q=>{
  const [row]=await q.select({attestationId:attestations.id,evidenceId:evidence.id,recipeId:salesEntries.recipeId,
   key:evidence.storageKey,contentSha256:attestations.contentSha256,byteLength:attestations.byteLength,sourceReference:attestations.sourceReference})
   .from(attestations).innerJoin(evidence,and(eq(evidence.id,attestations.evidenceId),eq(evidence.companyId,attestations.companyId),eq(evidence.branchId,attestations.branchId),eq(evidence.entityId,sql`${attestations.legacySaleId}::text`)))
   .innerJoin(salesEntries,and(eq(salesEntries.id,attestations.legacySaleId),eq(salesEntries.companyId,attestations.companyId),eq(salesEntries.branchId,attestations.branchId)))
   .innerJoin(branches,and(eq(branches.id,salesEntries.branchId),eq(branches.companyId,salesEntries.companyId)))
   .innerJoin(recipes,and(eq(recipes.id,salesEntries.recipeId),eq(recipes.companyId,salesEntries.companyId)))
   .where(and(eq(attestations.id,data.attestationId),eq(attestations.companyId,companyId),eq(attestations.branchId,data.branchId),eq(attestations.legacySaleId,data.legacySaleId),
    eq(attestations.purpose,'RECIPE_VERSION'),eq(evidence.entityType,'SALE_RECOVERY'),isNull(evidence.deletedAt),eq(attestations.storageKey,evidence.storageKey),
    eq(attestations.evidenceUpdatedAt,evidence.updatedAt),sql`${attestations.verifiedAt} <= clock_timestamp()`))
   .for('share',{of:[evidence,salesEntries]});
  const key=row?`companies/${companyId}/branches/${data.branchId}/sales-recovery/${data.legacySaleId}/${row.evidenceId}`:null;
  if(!row||row.key!==key)throw ApiError.notFound('Atestación histórica vigente no encontrada');
  if(row.byteLength>MAX_HISTORICAL_RECIPE_BYTES)throw ApiError.conflict('El documento de receta excede 2 MiB');
  let bytes:Buffer|null;
  try{bytes=await getFromR2(row.key,{maxBytes:MAX_HISTORICAL_RECIPE_BYTES,timeoutMs:15000});}
  catch{throw new ApiError('No fue posible comprobar el documento histórico',502);}
  if(!bytes?.length||bytes.length!==row.byteLength||bytes.length>MAX_HISTORICAL_RECIPE_BYTES||createHash('sha256').update(bytes).digest('hex')!==row.contentSha256)
   throw ApiError.conflict('El documento histórico está ausente o cambió desde su revisión');
  let historical:Awaited<ReturnType<typeof decodeRecoveryHistoricalRecipe>>;
  try{historical=await decodeRecoveryHistoricalRecipe(bytes,{companyId,branchId:data.branchId,legacySaleId:data.legacySaleId,recipeId:row.recipeId,sourceReference:row.sourceReference});}
  catch(error){if(error instanceof SaleRecoveryReviewError)throw ApiError.conflict(error.message);throw error;}
  return{attestationId:row.attestationId,evidenceId:row.evidenceId,contentSha256:row.contentSha256,sourceReference:row.sourceReference,...historical};
 }).catch(error=>{
  if(isApiError(error))throw error;
  // No propagar SQL, parámetros ni contenido documental al wrapper HTTP.
  throw ApiError.internal('No fue posible cargar la receta histórica');
 });
}
