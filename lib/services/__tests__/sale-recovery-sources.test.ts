import { beforeEach, describe, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({auth:vi.fn(),context:vi.fn(),read:vi.fn(),configured:vi.fn()}));
vi.mock('@/lib/tenant-context',()=>({requireAuth:f.auth}));
vi.mock('@/lib/db/tenant-context',()=>({withCompanyContext:f.context}));
vi.mock('@/lib/storage/r2-client',()=>({getFromR2:f.read,isR2Configured:f.configured}));
import { readRecoverySourceDocument } from '../sale-recovery-sources';
const id='10000000-0000-4000-8000-000000000001';
const input=()=>({branchId:id,legacySaleId:id,attestationId:id,purpose:'SALE'});
beforeEach(()=>{vi.resetAllMocks();f.auth.mockResolvedValue({user:{id:'actor',role:'ADMIN',companyId:id}});f.configured.mockReturnValue(true);});
describe('autoridad del lector de fuentes históricas',()=>{
 it('sesión y autoridad administrativas son previas a DB/R2',async()=>{
  f.auth.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'),{statusCode:401}));
  await expect(readRecoverySourceDocument(input())).rejects.toMatchObject({statusCode:401});
  for(const user of [null,{id:'actor',role:'GERENTE',companyId:id},{id:'actor',role:'ADMIN',companyId:null},{id:' ',role:'OWNER',companyId:id}]){
   f.auth.mockResolvedValue({user});await expect(readRecoverySourceDocument(input())).rejects.toMatchObject({statusCode:403});
  }
  expect(f.context).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
 });
 it('no admite autoridad, snapshot, hechos ni identidad del cuerpo',async()=>{
  for(const patch of [{companyId:id},{verified:true},{consumptionState:'NOT_APPLIED'},{observedMovementIds:[]},{recipeSnapshot:{}},{purpose:'RECIPE_VERSION'},{source:'pos:client'}])
   await expect(readRecoverySourceDocument({...input(),...patch})).rejects.toMatchObject({statusCode:400});
  expect(f.context).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
 });
 it('almacenamiento obligatorio y errores SQL no filtran detalles privados',async()=>{
  f.configured.mockReturnValue(false);await expect(readRecoverySourceDocument(input())).rejects.toMatchObject({statusCode:503});
  expect(f.context).not.toHaveBeenCalled();f.configured.mockReturnValue(true);
  f.context.mockRejectedValue(new Error('SELECT private credentials'));
  await expect(readRecoverySourceDocument(input())).rejects.toMatchObject({statusCode:500,message:'No fue posible cargar la fuente histórica'});
  expect(f.read).not.toHaveBeenCalled();
 });
});
