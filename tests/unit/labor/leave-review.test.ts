import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAllLeaveRequests, overlappingRequests } from '@/lib/labor/leave-review';

afterEach(() => vi.unstubAllGlobals());

describe('consulta completa de permisos', () => {
  it('recorre las páginas conservando fechas y permite cancelar la consulta', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ requests: [{ id: 'one' }], pagination: { totalPages: 2 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ requests: [{ id: 'two' }], pagination: { totalPages: 2 } })));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await fetchAllLeaveRequests({ startDate: '2026-11-01' }, signal)).toHaveLength(2);
    expect(fetcher.mock.calls[1][0]).toContain('page=2');
    expect(fetcher.mock.calls[1][0]).toContain('startDate=2026-11-01');
    expect(fetcher.mock.calls[1][1]).toEqual({ signal });
  });

  it('no convierte HTTP fallido o contenido inválido en un calendario vacío', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(fetchAllLeaveRequests({})).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(fetchAllLeaveRequests({})).rejects.toThrow();
  });
});

describe('contexto de coincidencias', () => {
  const target = { id: 'target', userId: 'ana', branchId: 'centro', startDate: '2026-11-15T06:00:00Z', endDate: '2026-11-17T06:00:00Z', status: 'PENDING' };
  it('incluye cruces de extremos y distingue personas sin inventar sucursales', () => {
    const rows = [
      target,
      { ...target, id: 'earlier', userId: 'beto', startDate: '2026-10-30', endDate: '2026-11-15', status: 'APPROVED' },
      { ...target, id: 'later', userId: 'caro', startDate: '2026-11-17', endDate: '2026-12-02' },
      { ...target, id: 'outside', userId: 'dani', startDate: '2026-11-18' },
      { ...target, id: 'rejected', userId: 'eli', status: 'REJECTED' },
      { ...target, id: 'cancelled', userId: 'fer', status: 'CANCELLED' },
      { ...target, id: 'same-person', status: 'APPROVED' },
      { ...target, id: 'other-branch', userId: 'gus', branchId: 'norte' },
      { ...target, id: 'unknown-branch', userId: 'hugo', branchId: null },
    ];
    expect(overlappingRequests(target, rows).map(row => row.id)).toEqual(['earlier', 'later']);
    expect(overlappingRequests({ ...target, branchId: null }, rows)).toEqual([]);
  });
});
