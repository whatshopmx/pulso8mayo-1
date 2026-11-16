import { z } from 'zod';
import { validateSaleDay } from './sale-consumption-contract';
import { buildSaleRecipeSnapshot } from './sale-consumption-snapshot';
import { SaleRecoveryReviewError } from './sale-recovery-review';

const uuid=z.string().uuid().toLowerCase();
const text=z.string().trim().min(1).max(2000);
const unit=z.string().min(1).max(64).refine(s=>s===s.trim());
const quantity=z.string().min(1).max(32);
const day=z.string().refine(value=>{try{validateSaleDay(value);return true;}catch{return false;}});
const subjectSchema=z.object({companyId:uuid,branchId:uuid,legacySaleId:uuid,recipeId:uuid,sourceReference:text}).strict();
const line=z.object({id:uuid,itemId:uuid,quantity,unit,isSubRecipe:z.boolean(),yieldPercent:z.number().int().min(1).max(100).nullable()}).strict();
const recipe=z.object({id:uuid,companyId:uuid,baseYield:quantity,unit,items:z.array(line).min(1).max(10000)}).strict();
const ingredient=z.object({id:uuid,companyId:uuid,unit}).strict();
const conversion=z.object({id:uuid,companyId:uuid,fromUnit:unit,toUnit:unit,factor:quantity}).strict();
const documentSchema=subjectSchema.extend({schemaVersion:z.literal(1),kind:z.literal('SALE_RECOVERY_RECIPE'),
 saleDay:day,validFrom:day,validThrough:day,recipes:z.array(recipe).min(1).max(1000),
 ingredients:z.array(ingredient).min(1).max(10000),conversions:z.array(conversion).max(10000)}).strict();
export const MAX_HISTORICAL_RECIPE_BYTES=2*1024*1024;

/** Solo decodifica bytes ya contrastados con una atestación del servidor; no autoriza stock. */
export async function decodeRecoveryHistoricalRecipe(bytes:Buffer,subject:unknown){
 try{
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_HISTORICAL_RECIPE_BYTES)throw new Error('size');
  const expected=subjectSchema.parse(subject);
  const document=documentSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  for(const key of ['companyId','branchId','legacySaleId','recipeId','sourceReference'] as const)
   if(document[key]!==expected[key])throw new Error('subject');
  if(document.validFrom>document.saleDay||document.saleDay>document.validThrough)throw new Error('validity');
  function index<T extends {id:string;companyId:string}>(rows:T[]){
   if(rows.some(row=>row.companyId!==expected.companyId)||new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('scope');
   return new Map(rows.map(row=>[row.id,row]));
  }
  const recipes=index(document.recipes),ingredients=index(document.ingredients),conversions=index(document.conversions);
  if(document.recipes.reduce((sum,row)=>sum+row.items.length,0)>10000)throw new Error('lines');
  const usedRecipes=new Set<string>(),usedIngredients=new Set<string>(),usedConversions=new Set<string>();
  const recipeSnapshot=await buildSaleRecipeSnapshot(expected.companyId,expected.recipeId,{
   recipe:async id=>{
    usedRecipes.add(id);const row=recipes.get(id);
    // strictNullChecks=false hace opcional el nullable inferido por Zod. El reader exige la propiedad explícita.
    return row?{...row,items:row.items.map(item=>({...item,yieldPercent:item.yieldPercent??null}))}:null;
   },
   ingredient:async id=>{usedIngredients.add(id);return ingredients.get(id)??null;},
   conversions:async(from,to)=>[...conversions.values()].filter(row=>{
    const match=(row.fromUnit===from&&row.toUnit===to)||(row.fromUnit===to&&row.toUnit===from);
    if(match)usedConversions.add(row.id);return match;
   }),
  });
  if(usedRecipes.size!==recipes.size||usedIngredients.size!==ingredients.size||usedConversions.size!==conversions.size)throw new Error('unused');
  return{saleDay:document.saleDay,validFrom:document.validFrom,validThrough:document.validThrough,recipeSnapshot};
 }catch{
  throw new SaleRecoveryReviewError('INVALID_RECORD','Documento histórico inválido, incompleto o fuera del alcance y vigencia');
 }
}
