import { describe, expect, it } from 'vitest';
import { resolveBranchPreference } from '../resource-scope';

describe('RP-02c1 · preferencias no conceden autoridad', () => {
  it.each(['GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'] as const)('%s ignora cookie de otra identidad', role => {
    expect(resolveBranchPreference(role, 'a', ['a', 'b'], 'b'))
      .toEqual({ kind: 'BRANCH', selectedBranchId: 'a', branchIds: ['a'], fixed: true });
    expect(resolveBranchPreference(role, null, ['a', 'b'], 'b'))
      .toEqual({ kind: 'NONE', selectedBranchId: null, branchIds: [], fixed: true });
    expect(resolveBranchPreference(role, 'removed', ['a', 'b'], 'b').kind).toBe('NONE');
  });
  it('ADMIN conserva Todas y su elección válida; descarta cookie fuera del catálogo', () => {
    expect(resolveBranchPreference('ADMIN', 'a', ['a', 'b'], null).kind).toBe('ALL');
    expect(resolveBranchPreference('ADMIN', 'a', ['a', 'b'], 'b').selectedBranchId).toBe('b');
    expect(resolveBranchPreference('ADMIN', 'a', ['a', 'b'], 'other-company').selectedBranchId).toBeNull();
  });
  it('OWNER conserva elección de empresa; desconocido no ve catálogo', () => {
    expect(resolveBranchPreference('OWNER', null, ['a', 'b'], null).branchIds).toEqual(['a', 'b']);
    expect(resolveBranchPreference('UNKNOWN' as never, 'a', ['a', 'b'], 'a'))
      .toEqual({ kind: 'NONE', selectedBranchId: null, branchIds: [], fixed: true });
  });
});
