import { describe, expect, it } from 'vitest';
import { decodeRecoverySourceDocument } from '../sale-recovery-source-documents';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const subject={companyId:id(1),branchId:id(2),legacySaleId:id(3),recipeId:id(4),sourceReference:'Corte firmado 001'};
const sale=()=>({schemaVersion:1,kind:'SALE_RECOVERY_SALE',...subject,source:'pos:main',productKey:'SKU-01',saleDay:'2026-11-01',quantitySold:'3',totalRevenueCents:null});
const absence=()=>({...sale(),kind:'SALE_RECOVERY_NO_PRIOR_CONSUMPTION',consumptionState:'NOT_APPLIED',
 basis:{system:'Inventario POS',recordReference:'Exportación íntegra 001',explanation:'Venta registrada sin aplicar inventario; se revisó el registro de ejecución del origen'}});
const bytes=(v:unknown)=>Buffer.from(JSON.stringify(v));
describe('documentos fuente de recuperación (declaraciones revisadas, sin autorización de stock)',()=>{
 it('normaliza identidad y cantidad exacta, conservando ingreso desconocido frente a cero',()=>{
  const result=decodeRecoverySourceDocument(bytes(sale()),subject,'SALE');
  expect(result).toMatchObject({identity:{companyId:id(1),branchId:id(2),source:'pos:main',productKey:'SKU-01',saleDay:'2026-11-01'},quantitySold:'3.00',totalRevenueCents:null});
  expect(decodeRecoverySourceDocument(bytes({...sale(),totalRevenueCents:0}),subject,'SALE').totalRevenueCents).toBe(0);
 });
 it('exige fundamento documental de no aplicación; no deduce cero de una consulta vacía',()=>{
  expect(decodeRecoverySourceDocument(bytes(absence()),subject,'NO_PRIOR_CONSUMPTION')).toMatchObject({consumptionState:'NOT_APPLIED',basis:absence().basis});
  for(const patch of [{basis:undefined},{basis:{system:'POS',recordReference:'',explanation:'revisado'}},{consumptionState:'UNKNOWN'},{consumptionState:'APPLIED'}, {observedMovementIds:[]}])
   expect(()=>decodeRecoverySourceDocument(bytes({...absence(),...patch}),subject,'NO_PRIOR_CONSUMPTION')).toThrow();
 });
 it('rechaza cada componente del sujeto y procedencia discordante',()=>{
  for(const patch of [{companyId:id(9)},{branchId:id(9)},{legacySaleId:id(9)},{recipeId:id(9)},{sourceReference:'Otro corte'}])
   expect(()=>decodeRecoverySourceDocument(bytes({...sale(),...patch}),subject,'SALE')).toThrow();
 });
 it('rechaza propósito cruzado, versión desconocida y autoridad incrustada',()=>{
  expect(()=>decodeRecoverySourceDocument(bytes(sale()),subject,'NO_PRIOR_CONSUMPTION')).toThrow();
  expect(()=>decodeRecoverySourceDocument(bytes(absence()),subject,'SALE')).toThrow();
  for(const patch of [{schemaVersion:2},{verified:true},{approvedBy:'admin'},{recipeSnapshot:{}},{basis:{}}])
   expect(()=>decodeRecoverySourceDocument(bytes({...sale(),...patch}),subject,'SALE')).toThrow();
 });
 it('valida día civil, fuente, producto, cantidad e ingreso sin redondear ni inferir',()=>{
  for(const patch of [{saleDay:'2026-02-30'},{source:'bad/source'},{productKey:' '},{quantitySold:'1.001'},
   {quantitySold:'100000000'},{quantitySold:-1},{totalRevenueCents:undefined},{totalRevenueCents:-1},{totalRevenueCents:1.5},{totalRevenueCents:2147483648}])
   expect(()=>decodeRecoverySourceDocument(bytes({...sale(),...patch}),subject,'SALE')).toThrow();
 });
 it('rechaza bytes vacíos, UTF8/JSON inválidos y tamaño excesivo con error opaco',()=>{
  for(const value of [Buffer.alloc(0),Buffer.from([0xff]),Buffer.from('{private'),Buffer.alloc(2097153)])
   expect(()=>decodeRecoverySourceDocument(value,subject,'SALE')).toThrow('Documento fuente inválido, incompleto o fuera del alcance');
 });
});
