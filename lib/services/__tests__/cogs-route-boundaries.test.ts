import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiError } from '@/lib/api/error';

const fixture = vi.hoisted(() => ({ authError: null as unknown, tenantError: null as unknown,
  role: 'ADMIN', branchId: 'ed11aaa9-b893-45da-b339-bbba36162b32', report: vi.fn() }));
vi.mock('@/lib/tenant-context', () => ({
  requireTenant: async () => { if (fixture.tenantError) throw fixture.tenantError; return { id: 'company' }; },
  requireAuth: async () => { if (fixture.authError) throw fixture.authError; return { user: { role: fixture.role, branchId: fixture.branchId } }; },
}));
vi.mock('@/lib/services/inventory-reports-service', () => ({
  CogsReportScopeError: class extends Error {},
  InventoryReportsService: { getCogsReport: fixture.report },
}));
import { GET } from '@/app/api/inventory/reports/cogs/route';

beforeEach(() => {
  fixture.authError = null; fixture.tenantError = null; fixture.role = 'ADMIN';
  fixture.branchId = 'ed11aaa9-b893-45da-b339-bbba36162b32';
  fixture.report.mockReset().mockResolvedValue({ revenueCents: null });
});
async function request(query: string) {
  return GET(new NextRequest(`http://localhost/api/inventory/reports/cogs?${query}`));
}
const valid = 'branchId=ed11aaa9-b893-45da-b339-bbba36162b32';

it.each([['sin sesión', ApiError.unauthorized(), 401], ['tenant ajeno', ApiError.forbidden(), 403]] as const)
('%s conserva el estado HTTP y no consulta ventas', async (_label, error, status) => {
  fixture.tenantError = error;
  const response = await request(valid);
  expect(response.status).toBe(status);
  expect(await response.json()).not.toHaveProperty('report');
  expect(fixture.report).not.toHaveBeenCalled();
});

it.each(['branchId=invalid', `${valid}&startDate=not-a-date`, `${valid}&endDate=2026-02-30`,
  `${valid}&startDate=2026-11-17&endDate=2026-11-16`])
('rechaza parámetros inválidos antes de consultar: %s', async query => {
  const response = await request(query);
  expect(response.status).toBe(400);
  expect(await response.json()).not.toHaveProperty('report');
  expect(fixture.report).not.toHaveBeenCalled();
});

it('una asignación ausente se deniega; una selección de sucursal ausente pide selección', async () => {
  expect((await request('')).status).toBe(400);
  fixture.role = 'GERENTE'; fixture.branchId = '';
  expect((await request(valid)).status).toBe(403);
  expect(fixture.report).not.toHaveBeenCalled();
});

it('conserva fechas civiles e instantes ISO válidos', async () => {
  for (const dates of ['startDate=2026-11-16&endDate=2026-11-16',
    'startDate=2026-11-16T00:00:00Z&endDate=2026-11-17T01:00:00%2B01:00']) {
    expect((await request(`${valid}&${dates}`)).status).toBe(200);
  }
});

it('un error inesperado no expone detalles internos', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    fixture.report.mockRejectedValue(new Error('secret database diagnostic'));
    const response = await request(valid);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Error interno del servidor' });
  } finally { log.mockRestore(); }
});
