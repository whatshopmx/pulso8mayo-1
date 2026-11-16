import { describe, expect, it } from 'vitest';
import { decodeRecoveryHistoricalRecipe } from '../sale-recovery-historical-recipe';
import { saleSnapshotDemand } from '../sale-consumption-snapshot';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const subject={companyId:id(1),branchId:id(2),legacySaleId:id(3),recipeId:id(4),sourceReference:'Archivo firmado receta 001'};
function document(){return{schemaVersion:1,kind:'SALE_RECOVERY_RECIPE',...subject,saleDay:'2026-11-01',validFrom:'2026-10-01',validThrough:'2026-11-30',
 recipes:[{id:id(4),companyId:id(1),baseYield:'2',unit:'PORTION',items:[{id:id(5),itemId:id(6),quantity:'500',unit:'G',isSubRecipe:false,yieldPercent:100}]}],
 ingredients:[{id:id(6),companyId:id(1),unit:'KG'}],conversions:[{id:id(7),companyId:id(1),fromUnit:'G',toUnit:'KG',factor:'0.001'}]};}
const bytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
describe('receta histórica reconstruida desde documento',()=>{
 it('recalcula desde definición y conversión históricas; no acepta demanda precomputada',async()=>{
  const parsed=await decodeRecoveryHistoricalRecipe(bytes(document()),subject);
  expect(parsed).toMatchObject({saleDay:'2026-11-01',validFrom:'2026-10-01',validThrough:'2026-11-30'});
  expect(saleSnapshotDemand(parsed.recipeSnapshot,'3')).toEqual([{itemId:id(6),unit:'KG',quantity:'0.7500'}]);
  await expect(decodeRecoveryHistoricalRecipe(bytes({...document(),recipeSnapshot:{},verified:true}),subject)).rejects.toThrow();
 });
 it('rechaza alcance, receta, procedencia y vigencia discordantes',async()=>{
  for(const patch of [{companyId:id(90)},{branchId:id(90)},{legacySaleId:id(90)},{recipeId:id(90)},
   {sourceReference:'Otro archivo'},{validFrom:'2026-11-02'},{validThrough:'2026-10-31'},{saleDay:'2026-02-30'}])
   await expect(decodeRecoveryHistoricalRecipe(bytes({...document(),...patch}),subject)).rejects.toThrow();
 });
 it('no permite registros de otra empresa, duplicados ni recursos sobrantes',async()=>{
  const d=document();for(const patch of [
   {recipes:[{...d.recipes[0],companyId:id(90)}]}, {ingredients:[{...d.ingredients[0],companyId:id(90)}]},
   {conversions:[{...d.conversions[0],companyId:id(90)}]}, {recipes:[...d.recipes,...d.recipes]},
   {ingredients:[...d.ingredients,{...d.ingredients[0],id:id(91)}]},
   {conversions:[...d.conversions,{...d.conversions[0],id:id(92),fromUnit:'L',toUnit:'ML'}]},
  ])await expect(decodeRecoveryHistoricalRecipe(bytes({...d,...patch}),subject)).rejects.toThrow();
 });
 it('rechaza árbol incompleto, conversiones ambiguas y ciclos',async()=>{
  const d=document();for(const patch of [{ingredients:[]},{conversions:[]},
   {conversions:[...d.conversions,{...d.conversions[0],id:id(93)}]},
   {recipes:[{...d.recipes[0],items:[{...d.recipes[0].items[0],itemId:id(4),isSubRecipe:true}]}]},
  ])await expect(decodeRecoveryHistoricalRecipe(bytes({...d,...patch}),subject)).rejects.toThrow();
 });
 it('admite rendimiento explícito null como 100% y exige el campo documental',async()=>{
  const d=document();const valid={...d,recipes:[{...d.recipes[0],items:[{...d.recipes[0].items[0],yieldPercent:null}]}]};
  const decoded=await decodeRecoveryHistoricalRecipe(bytes(valid),subject);
  expect(saleSnapshotDemand(decoded.recipeSnapshot,'3')).toEqual([{itemId:id(6),unit:'KG',quantity:'0.7500'}]);
  const missing=JSON.parse(JSON.stringify(valid));delete missing.recipes[0].items[0].yieldPercent;
  await expect(decodeRecoveryHistoricalRecipe(bytes(missing),subject)).rejects.toThrow();
 });
 it('rechaza UTF8/JSON inválidos, formato desconocido y exceso antes de reconstruir',async()=>{
  for(const b of [Buffer.from([0xff]),Buffer.from('{'),Buffer.alloc(2097153),bytes({...document(),schemaVersion:2})])
   await expect(decodeRecoveryHistoricalRecipe(b,subject)).rejects.toThrow();
 });
 it('expande subreceta histórica sin consultar catálogo actual y conserva huella estable',async()=>{
  const d=document();d.recipes[0].items=[{...d.recipes[0].items[0],itemId:id(8),quantity:'1',unit:'PORTION',isSubRecipe:true}];
  d.recipes.push({id:id(8),companyId:id(1),baseYield:'1',unit:'PORTION',items:[{id:id(9),itemId:id(6),quantity:'500',unit:'G',isSubRecipe:false,yieldPercent:50}]});
  const first=await decodeRecoveryHistoricalRecipe(bytes(d),subject);d.recipes.reverse();
  const second=await decodeRecoveryHistoricalRecipe(bytes(d),subject);
  expect(first.recipeSnapshot.versionKey).toBe(second.recipeSnapshot.versionKey);
  expect(saleSnapshotDemand(first.recipeSnapshot,'3')).toEqual([{itemId:id(6),unit:'KG',quantity:'1.5000'}]);
 });
});
