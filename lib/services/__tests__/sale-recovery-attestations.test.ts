import { beforeEach, describe, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({auth:vi.fn(),context:vi.fn(),read:vi.fn(),sign:vi.fn(),configured:vi.fn()}));
vi.mock('@/lib/tenant-context',()=>({requireAuth:f.auth}));
vi.mock('@/lib/db/tenant-context',()=>({withCompanyContext:f.context}));
vi.mock('@/lib/storage/r2-client',()=>({getFromR2:f.read,generatePresignedUrl:f.sign,isR2Configured:f.configured}));
import { previewRecoveryAttestation, recordRecoveryAttestation } from '../sale-recovery-attestations';
const id='10000000-0000-4000-8000-000000000001';
const input=()=>({branchId:id,legacySaleId:id,evidenceId:id,idempotencyKey:id,purpose:'SALE',sourceReference:'Corte original',reason:'Revisado con documento',expectedContentSha256:'a'.repeat(64)});
beforeEach(()=>{vi.resetAllMocks();f.auth.mockResolvedValue({user:{id:'actor',role:'ADMIN',companyId:id}});f.configured.mockReturnValue(true);});
describe('autoridad y DTO de atestación de recuperación',()=>{
  it('exige sesión administrativa antes de consultar DB o leer objetos',async()=>{
    f.auth.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'),{statusCode:401}));
    await expect(recordRecoveryAttestation(input())).rejects.toMatchObject({statusCode:401});
    for(const role of [undefined,'GERENTE','SUPERVISOR','EMPLEADO','READONLY','fake']){
      f.auth.mockResolvedValue({user:{id:'actor',role,companyId:id}});
      await expect(recordRecoveryAttestation(input())).rejects.toMatchObject({statusCode:403});
      await expect(previewRecoveryAttestation({branchId:id,evidenceId:id})).rejects.toMatchObject({statusCode:403});
    }
    expect(f.context).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();expect(f.sign).not.toHaveBeenCalled();
  });
  it('rechaza autoridad, hash de resultado, snapshot y bandera del cliente',async()=>{
    for(const data of [{...input(),companyId:id},{...input(),verifiedBy:'other'},{...input(),verifiedRole:'ADMIN'},
      {...input(),contentSha256:'a'.repeat(64)},{...input(),verified:true},{...input(),recipeSnapshot:{}},
      {...input(),purpose:'UNKNOWN'},{...input(),reason:' '},{...input(),sourceReference:''},{...input(),expectedContentSha256:'fake'}])
      await expect(recordRecoveryAttestation(data)).rejects.toMatchObject({statusCode:400});
    expect(f.context).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
  });
  it('R2 ausente y sesión sin empresa no crean una certificación local',async()=>{
    f.configured.mockReturnValue(false);await expect(recordRecoveryAttestation(input())).rejects.toMatchObject({statusCode:503});
    f.auth.mockResolvedValue({user:{id:'actor',role:'ADMIN',companyId:null}});
    await expect(recordRecoveryAttestation(input())).rejects.toMatchObject({statusCode:403});
    expect(f.context).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
  });
});
