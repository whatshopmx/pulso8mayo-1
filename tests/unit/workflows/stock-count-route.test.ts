import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/error';

const mocks = vi.hoisted(() => ({
  actor: { userId: 'reviewer', role: 'ADMIN', companyId: 'company', branchId: null },
  readAccess: vi.fn(), reviewAccess: vi.fn(), scope: vi.fn(), instance: vi.fn(), template: vi.fn(),
  select: vi.fn(), apply: vi.fn(), complete: vi.fn(), updateStep: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => ({ user: { id: 'reviewer', companyId: 'company' } }) } } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/db', () => ({ db: { query: { workflowInstances: { findFirst: mocks.instance }, workflowTemplates: { findFirst: mocks.template } }, select: mocks.select, update: mocks.update } }));
vi.mock('@/lib/workflows/execution-access', () => ({ requireExecutionAccess: mocks.readAccess, requireReviewAccess: mocks.reviewAccess, assertExecutionInScope: mocks.scope }));
vi.mock('@/lib/services/stock-count-service', () => ({ STOCK_COUNT_TEMPLATE_NAME: 'Conteo de Inventario', StockCountService: { applyStockCountAdjustments: mocks.apply, completeStockCount: mocks.complete } }));
vi.mock('@/lib/services/workflow-execution-service', () => ({ WorkflowExecutionService: { updateStep: mocks.updateStep } }));
import { GET, POST } from '@/app/api/inventory/stock-count/[id]/route';
import type { NextRequest } from 'next/server';

const params = { params: Promise.resolve({ id: 'instance' }) };
const request = (body?: object) => new Request('http://localhost/api/inventory/stock-count/instance', body ? { method: 'POST', body: JSON.stringify(body) } : undefined) as NextRequest;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.readAccess.mockResolvedValue(mocks.actor); mocks.reviewAccess.mockResolvedValue(mocks.actor);
  mocks.instance.mockResolvedValue({ id: 'instance', branchId: 'branch', assigneeId: 'worker', workflowTemplateId: 'template', data: { stockCountGrid: true }, status: 'COMPLETED' });
  mocks.template.mockResolvedValue({ name: 'Workflow de cierre' });
  const chain = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), limit: vi.fn(), set: vi.fn() };
  chain.from.mockReturnValue(chain); chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(Object.assign(Promise.resolve([]), { limit: async () => [{ id: 'instance', templateName: 'Workflow de cierre', data: {} }] }));
  chain.limit.mockResolvedValue([]); chain.set.mockReturnValue(chain);
  mocks.select.mockReturnValue(chain); mocks.update.mockReturnValue(chain);
  mocks.apply.mockResolvedValue({ applied: 2 }); mocks.updateStep.mockResolvedValue({ success: true });
});
describe('stock count route scope and review', () => {
  it('checks instance scope before reading its rows', async () => {
    mocks.scope.mockRejectedValue(ApiError.forbidden('Fuera de tu sucursal'));
    const response = await GET(request(), params);
    expect(response.status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it('does not mistake an ordinary workflow for a stock count', async () => {
    mocks.instance.mockResolvedValue({ id: 'instance', branchId: 'branch', assigneeId: null, workflowTemplateId: 'template', data: {} });
    expect((await GET(request(), params)).status).toBe(404);
  });
  it('requires reviewer access before applying adjustments', async () => {
    mocks.reviewAccess.mockRejectedValue(ApiError.forbidden('Tu rol no puede revisar'));
    expect((await POST(request({ action: 'applyAdjustments' }), params)).status).toBe(403);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('uses the validated execution service to update a step', async () => {
    const response = await POST(request({ action: 'updateStep', stepId: 'count-category', value: 'draft', stepMetadata: { systemQuantity: 999 } }), params);
    expect(response.status).toBe(200);
    expect(mocks.updateStep).toHaveBeenCalledWith('instance', 'count-category', { value: 'draft', status: 'COMPLETED' }, { kind: 'session', actor: mocks.actor, performedBy: 'reviewer' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
