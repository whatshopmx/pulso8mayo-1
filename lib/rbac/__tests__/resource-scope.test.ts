import { describe, expect, it } from 'vitest';
import { resolveResourceScope, targetInScope, type ScopeActor } from '../resource-scope';

const actor: ScopeActor = { userId: 'ana', role: 'EMPLEADO', companyId: 'company-a', branchId: 'branch-a' };
const branches = [{ id: 'branch-a', companyId: 'company-a' }, { id: 'branch-b', companyId: 'company-a' }, { id: 'branch-c', companyId: 'company-b' }];

describe('RP-02a · alcance de recurso desde identidad confiable', () => {
  it('OWN excluye un compañero en la misma sucursal y otra empresa', () => {
    const scope = resolveResourceScope(actor, 'workflows', 'read', branches, 'branch-b');
    expect(scope).toEqual({ kind: 'OWN', companyId: 'company-a', branchId: 'branch-a', userId: 'ana' });
    expect(targetInScope(scope, { companyId: 'company-a', branchId: 'branch-a', userId: 'ana' })).toBe(true);
    expect(targetInScope(scope, { companyId: 'company-a', branchId: 'branch-a', userId: 'pedro' })).toBe(false);
    expect(targetInScope(scope, { companyId: 'company-b', branchId: 'branch-a', userId: 'ana' })).toBe(false);
  });

  it.each(['GERENTE', 'SUPERVISOR', 'READONLY'] as const)('%s: preferencia ajena no amplía sucursal', role => {
    expect(resolveResourceScope({ ...actor, role }, 'reports', 'read', branches, 'branch-b'))
      .toEqual({ kind: 'BRANCH', companyId: 'company-a', branchId: 'branch-a' });
    expect(resolveResourceScope({ ...actor, role, branchId: null }, 'reports', 'read', branches)).toEqual({ kind: 'NONE' });
  });

  it.each(['ADMIN', 'OWNER', 'SUPER_ADMIN'] as const)('%s: empresa obligatoria y preferencia validada', role => {
    const admin = { ...actor, role, branchId: null };
    expect(resolveResourceScope(admin, 'reports', 'read', branches)).toEqual({ kind: 'COMPANY', companyId: 'company-a' });
    expect(resolveResourceScope(admin, 'reports', 'read', branches, 'branch-b')).toEqual({ kind: 'BRANCH', companyId: 'company-a', branchId: 'branch-b' });
    expect(resolveResourceScope(admin, 'reports', 'read', branches, 'branch-c')).toEqual({ kind: 'NONE' });
    expect(resolveResourceScope({ ...admin, companyId: null }, 'reports', 'read', branches)).toEqual({ kind: 'NONE' });
  });

  it('asignación ajena o borrada y capacidades denegadas dan NONE', () => {
    expect(resolveResourceScope({ ...actor, branchId: 'branch-c' }, 'workflows', 'read', branches)).toEqual({ kind: 'NONE' });
    expect(resolveResourceScope(actor, 'workflows', 'read', [])).toEqual({ kind: 'NONE' });
    expect(resolveResourceScope({ ...actor, role: 'READONLY' }, 'workflows', 'execute', branches)).toEqual({ kind: 'NONE' });
    expect(targetInScope({ kind: 'NONE' }, { companyId: 'company-a' })).toBe(false);
  });

  it('perfil es propio incluso para dirección y contexto incompleto deniega', () => {
    expect(resolveResourceScope({ ...actor, role: 'ADMIN' }, 'profile', 'read', branches))
      .toEqual({ kind: 'OWN', companyId: 'company-a', userId: 'ana' });
    const own = resolveResourceScope(actor, 'workflows', 'read', branches);
    expect(targetInScope(own, { companyId: 'company-a', userId: 'ana' })).toBe(false);
  });
});
