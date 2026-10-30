import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/error';

const mocks = vi.hoisted(() => ({ session: vi.fn(), cookie: vi.fn(), assertBranch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ get: mocks.cookie })) }));
vi.mock('@/lib/branch-scope', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/branch-scope')>(), assertBranchOfCompany: mocks.assertBranch }));
import { resolveRequestBranchScope } from '@/lib/server/effective-branch';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', companyId: 'company-a', branchId: 'assigned' } });
  mocks.cookie.mockReturnValue(undefined);
  mocks.assertBranch.mockResolvedValue(undefined);
});

describe('RP-02c2 · scope de petición', () => {
  it('valida empresa para una query explícita y nunca cae a ALL si es ajena', async () => {
    mocks.assertBranch.mockRejectedValue(ApiError.badRequest('fuera de empresa'));
    expect(await resolveRequestBranchScope('foreign')).toEqual({ kind: 'NONE' });
    expect(mocks.assertBranch).toHaveBeenCalledWith('company-a', 'foreign');
  });
  it('una cookie obsoleta de dirección se descarta como preferencia', async () => {
    mocks.cookie.mockImplementation(name => name === 'pulso_selected_branch' ? { value: 'removed' } : undefined);
    mocks.assertBranch.mockRejectedValue(ApiError.badRequest('borrada'));
    expect(await resolveRequestBranchScope()).toEqual({ kind: 'ALL' });
  });
  it.each(['GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'])('%s ignora query ajena y valida asignación', async role => {
    mocks.session.mockResolvedValue({ user: { id: 'a', role, companyId: 'company-a', branchId: 'assigned' } });
    expect(await resolveRequestBranchScope('foreign')).toEqual({ kind: 'BRANCH', branchId: 'assigned' });
    expect(mocks.assertBranch).toHaveBeenCalledWith('company-a', 'assigned');
    mocks.assertBranch.mockRejectedValue(ApiError.badRequest('asignación ajena'));
    expect(await resolveRequestBranchScope('foreign')).toEqual({ kind: 'NONE' });
  });
  it('sin empresa no consulta sucursales; un fallo de red no es vacío', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'a', role: 'SUPER_ADMIN' } });
    expect(await resolveRequestBranchScope('a')).toEqual({ kind: 'NONE' });
    expect(mocks.assertBranch).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', companyId: 'company-a' } });
    mocks.assertBranch.mockRejectedValue(new Error('network'));
    await expect(resolveRequestBranchScope('a')).rejects.toThrow('network');
  });
});
