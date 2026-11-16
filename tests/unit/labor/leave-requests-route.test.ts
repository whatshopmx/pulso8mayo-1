import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { GET } from '@/app/api/leave/requests/route';
import { db } from '@/lib/db';

vi.mock('@/lib/db', () => ({ db: { select: vi.fn() } }));
vi.mock('@/lib/api/with-auth', () => ({ withTenantAuth: (handler: (request: NextRequest, context: { auth: { tenantId: string; user: { id: string; role: string } } }) => Promise<Response>) => (request: NextRequest) => handler(request, {
  auth: { tenantId: 'tenant-a', user: { id: 'actor', role: 'GERENTE' } },
}) }));

beforeEach(() => vi.clearAllMocks());

it('consulta todo cruce de fechas, conserva el tenant y devuelve nombre de sucursal y total', async () => {
  const countWhere = vi.fn().mockResolvedValue([{ count: 25 }]);
  const countChain = { from: () => countChain, where: countWhere };
  const rowsWhere = vi.fn();
  const rows = { from: () => rows, leftJoin: vi.fn(() => rows), where: rowsWhere,
    orderBy: () => rows, limit: () => rows, offset: vi.fn().mockResolvedValue([{ id: 'request', branchName: 'Centro' }]) };
  rowsWhere.mockReturnValue(rows);
  vi.mocked(db.select).mockReturnValueOnce(countChain as never).mockReturnValueOnce(rows as never);
  const response = await GET(new NextRequest('http://localhost/api/leave/requests?startDate=2026-11-01&endDate=2026-11-30&limit=20&page=2'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ requests: [{ branchName: 'Centro' }], pagination: { total: 25, totalPages: 2 } });
  const query = new PgDialect().sqlToQuery(rowsWhere.mock.calls[0][0]);
  expect(query.sql).toContain('"leave_requests"."end_date" >=');
  expect(query.sql).toContain('"leave_requests"."start_date" <=');
  expect(query.params).toEqual(['tenant-a', '2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z']);
  expect(rows.offset).toHaveBeenCalledWith(20);
  expect(vi.mocked(db.select).mock.calls[1][0]).toHaveProperty('branchName');
});

it.each(['startDate=invalid', 'startDate=2026-11-31', 'startDate=2026-12-01&endDate=2026-11-01', 'page=0', 'limit=101'])(
  'rechaza parámetros inválidos antes de consultar: %s', async query => {
    expect((await GET(new NextRequest(`http://localhost/api/leave/requests?${query}`))).status).toBe(400);
    expect(db.select).not.toHaveBeenCalled();
  },
);
