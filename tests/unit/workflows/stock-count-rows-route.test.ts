import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/error';

/**
 * B1 — endpoint de filas de un conteo por categoría.
 *
 * La empresa sale de la sesión y la sucursal se valida contra el alcance del
 * actor antes de leer cualquier fila.
 */
const mocks = vi.hoisted(() => ({
  actor: { userId: 'u', role: 'ADMIN', companyId: 'company', branchId: null },
  access: vi.fn(), branch: vi.fn(), getCountRows: vi.fn(),
}));
vi.mock('@/lib/workflows/execution-access', () => ({
  requireExecutionAccess: mocks.access,
  assertBranchDestino: mocks.branch,
}));
vi.mock('@/lib/services/stock-count-service', () => ({
  StockCountService: { getCountRows: mocks.getCountRows },
}));

import { GET } from '@/app/api/inventory/stock-count/rows/route';
import type { NextRequest } from 'next/server';

const request = (query: string) =>
  new Request(`http://localhost/api/inventory/stock-count/rows${query}`) as NextRequest;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(mocks.actor);
  mocks.branch.mockResolvedValue(undefined);
  mocks.getCountRows.mockResolvedValue([{ itemId: 'i1', batchId: 'b1' }]);
});

describe('GET /api/inventory/stock-count/rows', () => {
  it('devuelve las filas de la empresa del actor para una categoría', async () => {
    const response = await GET(request('?branchId=branch&category=Verduras&highValueOnly=true'));
    expect(response.status).toBe(200);
    expect(mocks.getCountRows).toHaveBeenCalledWith('company', 'branch', 'Verduras', true);
    expect(await response.json()).toEqual({ rows: [{ itemId: 'i1', batchId: 'b1' }] });
  });

  it('rechaza una sucursal fuera del alcance sin leer filas', async () => {
    mocks.branch.mockRejectedValue(ApiError.forbidden('No puedes operar workflows de otra sucursal.'));
    const response = await GET(request('?branchId=ajena&category=Verduras'));
    expect(response.status).toBe(403);
    expect(mocks.getCountRows).not.toHaveBeenCalled();
  });

  it('exige categoría antes de tocar la base', async () => {
    const response = await GET(request('?branchId=branch'));
    expect(response.status).toBe(400);
    expect(mocks.getCountRows).not.toHaveBeenCalled();
  });
});
