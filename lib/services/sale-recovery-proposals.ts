import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { salesEntries, branches, recipes, saleRecoveryProposals as proposals } from '@/lib/db/schema';
import { setTenantContext } from '@/lib/db/tenant-context';
import { requireAuth } from '@/lib/tenant-context';
import { resolveBranchScope } from '@/lib/branch-scope';
import { hasPermission } from '@/lib/permissions';
import { ApiError, isApiError } from '@/lib/api/error';
import { isR2Configured } from '@/lib/storage/r2-client';
import { loadRecoveryDocumentInTransaction } from './sale-recovery-sources';
import { decodeRecoverySourceDocument } from './sale-recovery-source-documents';
import { decodeRecoveryHistoricalRecipe } from './sale-recovery-historical-recipe';
import { prepareSaleRecoveryReview, SaleRecoveryReviewError } from './sale-recovery-review';
import { soldQuantity, saleConsumptionIdentityKey } from './sale-consumption-contract';

const uuid=z.string().uuid().toLowerCase();
const request=z.object({branchId:uuid,legacySaleId:uuid,idempotencyKey:uuid,reason:z.string().trim().min(1).max(2000),
 saleAttestationId:uuid,recipeAttestationId:uuid,absenceAttestationId:uuid}).strict()
 .refine(value=>new Set([value.saleAttestationId,value.recipeAttestationId,value.absenceAttestationId]).size===3);

/** Prepara y registra un expediente; no decide, adopta ventas ni escribe stock. */
export async function registerRecoveryProposal(input:unknown){
 const {user}=await requireAuth();
 if(!user||typeof user.id!=='string'||!user.id.trim()||user.id!==user.id.trim()||user.id.length>256
  ||!uuid.safeParse(user.companyId).success||!['ADMIN','OWNER','SUPER_ADMIN'].includes(user.role)||!hasPermission(user.role,'inventory','manage'))
  throw ApiError.forbidden('El expediente requiere una sesión administrativa de la empresa');
 const parsed=request.safeParse(input);if(!parsed.success)throw ApiError.badRequest('Referencias del expediente inválidas');
 const data=parsed.data,companyId=uuid.parse(user.companyId),actorId=user.id;
 const branchScope=resolveBranchScope(user.role,typeof user.branchId==='string'?user.branchId.toLowerCase():null,data.branchId);
 if(branchScope.kind!=='BRANCH'||branchScope.branchId!==data.branchId)throw ApiError.forbidden('Sucursal fuera del alcance autorizado');
 if(!isR2Configured())throw new ApiError('Almacenamiento privado no disponible',503);
 const scope={companyId,branchId:data.branchId,actorId};
 try{
  return await db.transaction(async tx=>{
   await setTenantContext(tx,scope);
   // Snapshot serializable y locks compartidos; aplicar requerirá revalidación y coordinación con el writer.
   const loaded:Awaited<ReturnType<typeof loadRecoveryDocumentInTransaction>>[]=[];
   for(const [purpose,attestationId] of [['SALE',data.saleAttestationId],['RECIPE_VERSION',data.recipeAttestationId],['NO_PRIOR_CONSUMPTION',data.absenceAttestationId]] as const)
    loaded.push(await loadRecoveryDocumentInTransaction(tx,scope,{legacySaleId:data.legacySaleId,attestationId,purpose}));
   const [saleProof,recipeProof,absenceProof]=loaded;
   const subject=(row:typeof saleProof)=>({companyId,branchId:data.branchId,legacySaleId:data.legacySaleId,recipeId:row.row.recipeId,sourceReference:row.row.sourceReference});
   const sale=decodeRecoverySourceDocument(saleProof.bytes,subject(saleProof),'SALE');
   const absence=decodeRecoverySourceDocument(absenceProof.bytes,subject(absenceProof),'NO_PRIOR_CONSUMPTION');
   const historical=await decodeRecoveryHistoricalRecipe(recipeProof.bytes,subject(recipeProof));
   if(saleConsumptionIdentityKey(sale.identity)!==saleConsumptionIdentityKey(absence.identity)
    ||sale.recipeId!==absence.recipeId||sale.quantitySold!==absence.quantitySold||sale.totalRevenueCents!==absence.totalRevenueCents
    ||sale.saleDay!==historical.saleDay)
    throw ApiError.conflict('Las tres fuentes no describen la misma venta y cobertura');
   const [legacy]=await tx.select({id:salesEntries.id,companyId:salesEntries.companyId,branchId:salesEntries.branchId,recipeId:salesEntries.recipeId,
    quantitySold:salesEntries.quantitySold,totalRevenue:salesEntries.totalRevenue,
    updatedAt:sql<string>`to_char(${salesEntries.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`})
    .from(salesEntries).innerJoin(branches,and(eq(branches.id,salesEntries.branchId),eq(branches.companyId,salesEntries.companyId)))
    .innerJoin(recipes,and(eq(recipes.id,salesEntries.recipeId),eq(recipes.companyId,salesEntries.companyId)))
    .where(and(eq(salesEntries.id,data.legacySaleId),eq(salesEntries.companyId,companyId),eq(salesEntries.branchId,data.branchId))).for('share',{of:salesEntries});
   if(!legacy||legacy.recipeId!==sale.recipeId||soldQuantity(legacy.quantitySold)!==sale.quantitySold||legacy.totalRevenue!==(sale.totalRevenueCents??0))
    throw ApiError.conflict('La proyección legada no coincide con las fuentes documentales');
   // Ninguna consulta vacía demuestra cero: se exige además el documento NO_PRIOR_CONSUMPTION atestiguado.
   // Bloquear cualquier revisión de esta receta/día o del producto evita adoptar una proyección agregada.
   const heads=await tx.execute(sql`SELECT r.id FROM sales_consumption_revisions r JOIN sales_consumption_identities i ON i.id=r.identity_id
    WHERE r.company_id=${companyId} AND r.branch_id=${data.branchId} AND i.company_id=${companyId} AND i.branch_id=${data.branchId}
     AND i.sale_day=${sale.saleDay}::date AND (r.recipe_id=${sale.recipeId}::uuid OR (i.source=${sale.source} AND i.product_key=${sale.productKey})) LIMIT 1`);
   if(heads.rows.length)throw ApiError.conflict('La venta o proyección ya tiene revisiones; requiere otra recuperación');
   // El snapshot se valida por prepareSaleRecoveryReview antes de utilizar su demanda como filtro.
   const prepared=prepareSaleRecoveryReview({schemaVersion:2,idempotencyKey:data.idempotencyKey,requestedBy:actorId,reason:data.reason,
    identity:sale.identity,legacy:{id:legacy.id,companyId,branchId:data.branchId,recipeId:legacy.recipeId,saleDay:sale.saleDay,
     quantitySold:legacy.quantitySold,totalRevenueCents:sale.totalRevenueCents,updatedAt:legacy.updatedAt},
    observedHeadId:null,consumptionState:'NOT_APPLIED',observedMovementIds:[],recipeSnapshot:historical.recipeSnapshot,evidence:loaded.map(row=>row.proof)});
   // La demanda redondeada puede estar vacía por venta cero o cantidades pequeñas.
   // La atribución de movimientos usa todos los ingredientes del snapshot ya verificado.
   const ingredientIds=z.object({ingredients:z.array(z.object({itemId:uuid}))})
    .parse(historical.recipeSnapshot.definition).ingredients.map(row=>row.itemId);
   const relatedItem=ingredientIds.length?sql`m.item_id IN (${sql.join(ingredientIds.map(id=>sql`${id}::uuid`),sql`, `)})`:sql`false`;
   const movements=await tx.execute(sql`SELECT m.id FROM inventory_movements m JOIN inventory_items item ON item.id=m.item_id
    WHERE m.branch_id=${data.branchId} AND item.company_id=${companyId} AND (
     m.reference_id=${data.legacySaleId} OR m.reference_id=${'sale:'+data.legacySaleId}
     OR m.reference_id LIKE ${'salecons:%'} AND EXISTS (SELECT 1 FROM sales_consumption_identities i
       WHERE i.company_id=${companyId} AND i.branch_id=${data.branchId} AND i.sale_day=${sale.saleDay}::date
        AND i.source=${sale.source} AND i.product_key=${sale.productKey} AND (m.reference_id='salecons:'||i.id::text OR m.reference_id LIKE 'salecons:'||i.id::text||':reverse:%'))
     OR (m.type='USAGE' AND m.reference_id IS NULL AND ${relatedItem})) LIMIT 1`);
   if(movements.rows.length)throw ApiError.conflict('Existen movimientos previos o sin atribución; no se demuestra consumo cero');
   const values={companyId,branchId:data.branchId,legacySaleId:data.legacySaleId,idempotencyKey:data.idempotencyKey,
    requestedBy:actorId,reason:data.reason,proposalHash:prepared.proposalHash,stateHash:prepared.stateHash,proposal:prepared.proposal,createdAt:sql`clock_timestamp()`};
   const inserted=await tx.insert(proposals).values(values).onConflictDoNothing({target:[proposals.companyId,proposals.idempotencyKey]}).returning({id:proposals.id});
   const [stored]=await tx.select().from(proposals).where(and(eq(proposals.companyId,companyId),eq(proposals.idempotencyKey,data.idempotencyKey)));
   if(!stored||stored.branchId!==data.branchId||stored.legacySaleId!==data.legacySaleId||stored.proposalHash!==prepared.proposalHash||stored.stateHash!==prepared.stateHash)
    throw ApiError.conflict('La clave idempotente corresponde a otro expediente o estado');
   const frozen=prepareSaleRecoveryReview(stored.proposal);
   if(frozen.proposalHash!==stored.proposalHash||frozen.stateHash!==stored.stateHash)throw ApiError.conflict('El expediente persistido es incompatible');
   return{id:stored.id,created:inserted.length===1,proposalHash:stored.proposalHash,stateHash:stored.stateHash,demand:prepared.demand};
  },{isolationLevel:'serializable'});
 }catch(error){
  if(isApiError(error))throw error;
  if(error instanceof SaleRecoveryReviewError)throw ApiError.conflict(error.message);
  const failure=error as {code?:string;cause?:{code?:string}};
  if(['40001','40P01'].includes(failure.cause?.code??failure.code))throw ApiError.conflict('El estado cambió durante la preparación; reintenta con la misma clave');
  throw ApiError.internal('No fue posible preparar el expediente de recuperación');
 }
}
