import { beforeEach, describe, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({auth:vi.fn(),transaction:vi.fn(),storage:vi.fn()}));
vi.mock('@/lib/tenant-context',()=>({requireAuth:f.auth}));
vi.mock('@/lib/db',()=>({db:{transaction:f.transaction}}));
vi.mock('@/lib/storage/r2-client',()=>({isR2Configured:f.storage,getFromR2:vi.fn()}));
import { registerRecoveryProposal } from '../sale-recovery-proposals';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input=()=>({branchId:id(2),legacySaleId:id(3),idempotencyKey:id(4),reason:'Revisar recuperación documentada',
 saleAttestationId:id(5),recipeAttestationId:id(6),absenceAttestationId:id(7)});
beforeEach(()=>{vi.resetAllMocks();f.auth.mockResolvedValue({user:{id:'actor',role:'ADMIN',companyId:id(1)}});f.storage.mockReturnValue(true);});
describe('frontera administrativa de preparación de expedientes',()=>{
 it('rechaza falta de sesión y roles no administrativos antes de transacción',async()=>{
  f.auth.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'),{statusCode:401}));
  await expect(registerRecoveryProposal(input())).rejects.toMatchObject({statusCode:401});
  for(const user of [null,{id:'actor',role:'GERENTE',companyId:id(1)},{id:'actor',role:'ADMIN',companyId:null}]){
   f.auth.mockResolvedValue({user});await expect(registerRecoveryProposal(input())).rejects.toMatchObject({statusCode:403});
  }
  expect(f.transaction).not.toHaveBeenCalled();
 });
 it('solo admite referencias y motivo; no autoridad, estado, identidad o snapshot declarados por cliente',async()=>{
  for(const patch of [{companyId:id(1)},{requestedBy:'actor'},{approved:true},{consumptionState:'NOT_APPLIED'},
   {identity:{}},{legacy:{}},{observedMovementIds:[]},{recipeSnapshot:{}},{reason:' '},{recipeAttestationId:id(5)}])
   await expect(registerRecoveryProposal({...input(),...patch})).rejects.toMatchObject({statusCode:400});
  expect(f.transaction).not.toHaveBeenCalled();
 });
 it('requiere storage privado y no filtra errores SQL',async()=>{
  f.storage.mockReturnValue(false);await expect(registerRecoveryProposal(input())).rejects.toMatchObject({statusCode:503});
  expect(f.transaction).not.toHaveBeenCalled();f.storage.mockReturnValue(true);
  f.transaction.mockRejectedValue(new Error('private SQL parameters'));
  await expect(registerRecoveryProposal(input())).rejects.toMatchObject({statusCode:500,message:'No fue posible preparar el expediente de recuperación'});
  expect(f.transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'serializable'});
 });
});
