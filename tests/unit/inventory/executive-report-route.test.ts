import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiError } from '@/lib/api/error';

const state = vi.hoisted(() => ({
  role: 'ADMIN', branchId: null as string | null, allowed: true,
  sessionError: null as Error | null, report: vi.fn(), branch: vi.fn(),
}));
vi.mock('@/lib/tenant-context', () => ({
  requireTenant: async () => {
    if (state.sessionError) throw state.sessionError;
    return { id: 'c1000000-0000-4000-8000-000000000001' };
  },
  requireAuth: async () => ({ user: { role: state.role, branchId: state.branchId } }),
}));
vi.mock('@/lib/permissions', () => ({ hasPermission: () => state.allowed }));
vi.mock('@/lib/services/executive-report-service', () => ({ ExecutiveReportService: { getReport: state.report } }));
vi.mock('@/lib/branch-scope', async original => ({
  ...await original<typeof import('@/lib/branch-scope')>(), assertBranchOfCompany: state.branch,
}));
import { GET } from '@/app/api/inventory/reports/executive/route';

const branch = 'b1000000-0000-4000-8000-000000000001';
const call = (query = '') => GET(new NextRequest(`http://localhost/api/inventory/reports/executive${query}`));
beforeEach(() => {
  state.role = 'ADMIN'; state.branchId = null; state.allowed = true; state.sessionError = null;
  state.report.mockReset().mockResolvedValue({ consolidated: {}, byBranch: [] });
  state.branch.mockReset().mockResolvedValue(undefined);
});

it('rejects branch-bound users without assignment before reading report', async () => {
  state.role = 'GERENTE';
  expect((await call()).status).toBe(403);
  expect(state.report).not.toHaveBeenCalled();
});
it('uses assigned branch rather than requested branch for a manager', async () => {
  state.role = 'GERENTE'; state.branchId = branch;
  expect((await call('?branchId=b2000000-0000-4000-8000-000000000002')).status).toBe(200);
  expect(state.report).toHaveBeenCalledWith('c1000000-0000-4000-8000-000000000001', expect.any(Date), expect.any(Date), branch);
  expect(state.branch).toHaveBeenCalledWith('c1000000-0000-4000-8000-000000000001', branch);
});
it('permits company-wide consolidation for an admin', async () => {
  expect((await call()).status).toBe(200);
  expect(state.report.mock.calls[0][3]).toBeUndefined();
  expect(state.branch).not.toHaveBeenCalled();
});
it.each(['?branchId=bad', '?startDate=bad', '?startDate=2026-12-01&endDate=2026-11-01'])('rejects invalid input %s', async query => {
  expect((await call(query)).status).toBe(400);
  expect(state.report).not.toHaveBeenCalled();
});
it('preserves unauthorized session response', async () => {
  state.sessionError = ApiError.unauthorized('Sesión requerida');
  expect((await call()).status).toBe(401);
  expect(state.report).not.toHaveBeenCalled();
});
it('rejects foreign branch before reading report', async () => {
  state.branch.mockRejectedValue(ApiError.badRequest('Sucursal fuera de la empresa'));
  expect((await call(`?branchId=${branch}`)).status).toBe(400);
  expect(state.report).not.toHaveBeenCalled();
});
it('rejects missing permission before reading report', async () => {
  state.allowed = false;
  expect((await call()).status).toBe(403);
  expect(state.report).not.toHaveBeenCalled();
});
