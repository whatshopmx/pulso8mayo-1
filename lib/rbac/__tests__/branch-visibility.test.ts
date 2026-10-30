import { describe, expect, it } from 'vitest';
import { branchVisibilityFilter, type BranchOwnershipInfo } from '../branch-visibility';
import { buildOwnershipScope, type AccessContext } from '../abac';
import type { Role } from '@/lib/permissions';

const branches: BranchOwnershipInfo[] = [
  { id: 'a', companyId: 'company-a', ownershipType: 'OWNED' },
  { id: 'b', companyId: 'company-a', ownershipType: 'OWNED' },
  { id: 'franchise', companyId: 'company-a', ownershipType: 'FRANCHISE', franchiseeUserId: 'user-a' },
  { id: 'other-company', companyId: 'company-b', ownershipType: 'OWNED' },
];
function actor(role: Role, branchId: string | null = 'a'): AccessContext {
  return { userId: 'user-a', userRole: role, userCompanyId: 'company-a', userBranchId: branchId, ownershipScope: buildOwnershipScope(role) };
}

describe('RP-02b2 · visibilidad antes de agregar', () => {
  it.each(['ADMIN', 'OWNER', 'SUPER_ADMIN'] as const)('%s conserva empresa, excluye otra', role => {
    expect(branchVisibilityFilter(actor(role), branches)).toEqual(['a', 'b', 'franchise']);
  });
  it.each(['GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'] as const)('%s solo ve asignada y sin asignación NONE', role => {
    expect(branchVisibilityFilter(actor(role), branches)).toEqual(['a']);
    expect(branchVisibilityFilter(actor(role, null), branches)).toEqual([]);
  });
  it('franquicia propiedad del actor no amplía su sucursal asignada', () => {
    expect(branchVisibilityFilter(actor('GERENTE'), branches)).toEqual(['a']);
    expect(branchVisibilityFilter(actor('GERENTE', 'franchise'), branches)).toEqual(['franchise']);
    expect(branchVisibilityFilter(actor('READONLY', 'franchise'), branches)).toEqual([]);
  });
  it('rol o empresa ausentes no autorizan nada', () => {
    expect(branchVisibilityFilter(actor('UNKNOWN' as Role), branches)).toEqual([]);
    expect(branchVisibilityFilter({ ...actor('SUPER_ADMIN'), userCompanyId: '' }, branches)).toEqual([]);
  });
});
