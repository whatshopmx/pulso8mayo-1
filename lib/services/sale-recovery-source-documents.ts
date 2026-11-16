import { z } from 'zod';
import { normalizeSaleConsumptionIdentity, soldQuantity, validateSaleDay } from './sale-consumption-contract';
import { SaleRecoveryReviewError } from './sale-recovery-review';

const uuid=z.string().uuid().toLowerCase();
const text=z.string().trim().min(1).max(2000);
const subjectSchema=z.object({companyId:uuid,branchId:uuid,legacySaleId:uuid,recipeId:uuid,sourceReference:text}).strict();
const day=z.string().refine(value=>{try{validateSaleDay(value);return true;}catch{return false;}});
const sold=z.string().max(32).transform(value=>soldQuantity(value));
const common=subjectSchema.extend({schemaVersion:z.literal(1),source:z.string().max(64),productKey:z.string().max(512),
 saleDay:day,quantitySold:sold,totalRevenueCents:z.number().int().min(0).max(2147483647).nullable()});
const documentSchema=z.discriminatedUnion('kind',[
 common.extend({kind:z.literal('SALE_RECOVERY_SALE')}).strict(),
 common.extend({kind:z.literal('SALE_RECOVERY_NO_PRIOR_CONSUMPTION'),consumptionState:z.literal('NOT_APPLIED'),
  basis:z.object({system:text,recordReference:text,explanation:text}).strict()}).strict(),
]);
export const MAX_RECOVERY_SOURCE_BYTES=2*1024*1024;
export type RecoverySourcePurpose='SALE'|'NO_PRIOR_CONSUMPTION';

/** Decodifica una declaración documental; la veracidad y la aprobación no se deducen del JSON. */
export function decodeRecoverySourceDocument(bytes:Buffer,subject:unknown,purpose:RecoverySourcePurpose){
 try{
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_RECOVERY_SOURCE_BYTES)throw new Error('size');
  const expected=subjectSchema.parse(subject);
  const document=documentSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if((purpose==='SALE'&&document.kind!=='SALE_RECOVERY_SALE')
   ||(purpose==='NO_PRIOR_CONSUMPTION'&&document.kind!=='SALE_RECOVERY_NO_PRIOR_CONSUMPTION')
   ||!['SALE','NO_PRIOR_CONSUMPTION'].includes(purpose))throw new Error('purpose');
  for(const key of ['companyId','branchId','legacySaleId','recipeId','sourceReference'] as const)
   if(document[key]!==expected[key])throw new Error('subject');
  const identity=normalizeSaleConsumptionIdentity(document);
  return{...document,source:identity.source,productKey:identity.productKey,identity};
 }catch{
  throw new SaleRecoveryReviewError('INVALID_RECORD','Documento fuente inválido, incompleto o fuera del alcance');
 }
}
