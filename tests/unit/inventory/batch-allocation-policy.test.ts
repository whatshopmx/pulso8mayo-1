import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocateEligibleBatches, type AllocationRequest, type BatchCandidate } from '@/lib/services/batch-allocation-policy';

const now = new Date('2026-10-26T12:00:00Z');
const request: AllocationRequest = { companyId: 'company-a', branchId: 'branch-a', itemId: 'item-a', quantity: '1.2500', now };
function batch(id: string, overrides: Partial<BatchCandidate> = {}): BatchCandidate {
  return { id, companyId: request.companyId, branchId: request.branchId, itemId: request.itemId,
    status: 'AVAILABLE', currentQuantity: '1.0000', unitCost: 125,
    expirationDate: new Date('2026-11-01T00:00:00Z'), receivedAt: new Date('2026-10-20T00:00:00Z'),
    createdAt: new Date('2026-10-20T01:00:00Z'), ...overrides };
}
const ids = (batches: BatchCandidate[], options: Partial<AllocationRequest> = {}) =>
  allocateEligibleBatches(batches, { ...request, quantity: 10, ...options }).allocations.map(a => a.batchId);

describe('FEFO-04A: política pura de asignación', () => {
  it('FEFO toma la recepción más reciente cuando vence antes', () => {
    const older = batch('old');
    const newer = batch('new', { receivedAt: new Date('2026-10-25T00:00:00Z'), expirationDate: new Date('2026-10-27T00:00:00Z') });
    expect(ids([older, newer])).toEqual(['new', 'old']);
    expect(ids([newer, older], { policy: { strategy: 'FIFO', expiration: 'REQUIRED' } })).toEqual(['old', 'new']);
  });

  it('desempata por recepción, creación e ID sin depender del orden de entrada', () => {
    const batches = [batch('z'), batch('b'), batch('a'), batch('early-created', { createdAt: new Date('2026-10-20T00:00:00Z') }),
      batch('early-received', { receivedAt: new Date('2026-10-19T00:00:00Z') })];
    expect(ids(batches)).toEqual(['early-received', 'early-created', 'a', 'b', 'z']);
    expect(ids([...batches].reverse())).toEqual(ids(batches));
  });

  it.each(['EXPIRED', 'QUARANTINED', 'RESERVED', 'DEPLETED', null])('excluye estado %s', status => {
    expect(ids([batch('blocked', { status })])).toEqual([]);
  });

  it.each(['companyId', 'branchId', 'itemId'] as const)('excluye %s incompatible', field => {
    expect(ids([batch('foreign', { [field]: 'other' })])).toEqual([]);
  });

  it('rechaza vencido AVAILABLE aunque el cron no haya cambiado su estado', () => {
    expect(ids([batch('expired', { expirationDate: new Date(now.getTime() - 1) }),
      batch('limit', { expirationDate: now }), batch('valid', { expirationDate: new Date(now.getTime() + 1) })])).toEqual(['valid']);
  });

  it('conserva el instante histórico de medianoche sin extenderlo al fin del día', () => {
    expect(ids([batch('midnight', { expirationDate: new Date('2026-10-26T00:00:00Z') })])).toEqual([]);
  });

  it('bloquea fecha nula con política desconocida o requerida', () => {
    const undated = batch('undated', { expirationDate: null });
    expect(ids([undated])).toEqual([]);
    expect(ids([undated], { policy: { strategy: 'FIFO', expiration: 'REQUIRED' } })).toEqual([]);
  });

  it('permite fecha nula sólo con política explícita NONE; en FEFO queda al final', () => {
    const undated = batch('undated', { expirationDate: null });
    expect(ids([undated, batch('dated')], { policy: { strategy: 'FEFO', expiration: 'NONE' } })).toEqual(['dated', 'undated']);
    expect(ids([undated], { policy: { strategy: 'FIFO', expiration: 'NONE' } })).toEqual(['undated']);
    expect(ids([batch('expired', { expirationDate: now })], { policy: { strategy: 'FIFO', expiration: 'NONE' } })).toEqual([]);
  });

  it('selección explícita aplica las guardas y nunca sustituye el lote rechazado', () => {
    const candidates = [batch('wanted', { status: 'RESERVED' }), batch('other')];
    expect(ids(candidates, { batchId: 'wanted' })).toEqual([]);
    expect(ids(candidates, { batchId: 'missing' })).toEqual([]);
    expect(ids(candidates, { batchId: 'other' })).toEqual(['other']);
  });

  it('reparte fracciones y conserva costo en centavos y faltante exacto', () => {
    const result = allocateEligibleBatches([batch('a', { currentQuantity: '0.4000', unitCost: 123 }),
      batch('b', { currentQuantity: '0.8500', unitCost: null })], { ...request, quantity: '2.0000' });
    expect(result).toEqual({ allocations: [{ batchId: 'a', quantity: 0.4, unitCost: 123 },
      { batchId: 'b', quantity: 0.85, unitCost: null }], requestedQuantity: 2, allocatedQuantity: 1.25, shortfallQuantity: 0.75 });
  });

  it('no crea una asignación residual por errores de coma flotante', () => {
    const result = allocateEligibleBatches([batch('a', { currentQuantity: '0.1000' }), batch('b', { currentQuantity: '0.2000' }), batch('c')],
      { ...request, quantity: 0.1 + 0.2 });
    expect(result.allocations.map(a => a.quantity)).toEqual([0.1, 0.2]);
    expect(result.allocatedQuantity).toBe(0.3);
    expect(result.shortfallQuantity).toBe(0);
  });

  it.each(['0', '-1', 'NaN', '0.00001', '100000000', Number.NaN, Infinity])('rechaza solicitud inválida %s', quantity => {
    expect(() => allocateEligibleBatches([batch('a')], { ...request, quantity })).toThrow();
  });

  it('excluye saldo cero, negativo o inválido y fechas inválidas', () => {
    expect(ids([batch('zero', { currentQuantity: '0' }), batch('negative', { currentQuantity: '-1' }),
      batch('bad', { currentQuantity: 'NaN' }), batch('bad-date', { expirationDate: new Date('invalid') })])).toEqual([]);
  });

  it('rechaza reloj inválido y candidatos duplicados para no sobreasignar un lote', () => {
    expect(() => allocateEligibleBatches([batch('a')], { ...request, now: new Date('invalid') })).toThrow();
    expect(() => allocateEligibleBatches([batch('a'), batch('a')], request)).toThrow();
  });

  it('no modifica candidatos ni fechas recibidas', () => {
    const candidates = [batch('z'), batch('a')];
    const copy = structuredClone(candidates);
    allocateEligibleBatches(candidates, request);
    expect(candidates).toEqual(copy);
  });

  it('usa creación si falta recepción y deja antigüedad desconocida al final', () => {
    expect(ids([batch('unknown', { receivedAt: null, createdAt: null }),
      batch('fallback', { receivedAt: null, createdAt: new Date('2026-10-19T00:00:00Z') }), batch('known')]))
      .toEqual(['fallback', 'known', 'unknown']);
  });

  it('respeta el mínimo y máximo numeric(12,4) sin perder cantidad ni costo cero', () => {
    expect(allocateEligibleBatches([batch('max', { currentQuantity: '99999999.9999', unitCost: 0 })],
      { ...request, quantity: '99999999.9999' })).toEqual({ allocations: [{ batchId: 'max', quantity: 99999999.9999, unitCost: 0 }],
      requestedQuantity: 99999999.9999, allocatedQuantity: 99999999.9999, shortfallQuantity: 0 });
    expect(allocateEligibleBatches([batch('min', { currentQuantity: '0.0001' })], { ...request, quantity: '0.0001' }).shortfallQuantity).toBe(0);
  });

  it('selección explícita no exceptúa empresa, fecha ni saldo', () => {
    for (const overrides of [{ companyId: 'other' }, { expirationDate: now }, { expirationDate: null }, { currentQuantity: '0' }]) {
      expect(ids([batch('wanted', overrides), batch('other')], { batchId: 'wanted' })).toEqual([]);
    }
  });

  it('rechaza alcance ausente y política inválida en tiempo de ejecución', () => {
    expect(() => allocateEligibleBatches([batch('a')], { ...request, companyId: '' })).toThrow();
    expect(() => allocateEligibleBatches([batch('a')], { ...request, policy: { strategy: 'OTHER', expiration: 'NONE' } } as unknown as AllocationRequest)).toThrow();
  });

  it('conserva cantidades y no sobreasigna para repartos generados a cuatro decimales', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000 }), { maxLength: 20 }),
      fc.integer({ min: 1, max: 10_000_000 }), (balances, requested) => {
        const candidates = balances.map((balance, index) => batch(`batch-${index}`, { currentQuantity: (balance / 10_000).toFixed(4) }));
        const result = allocateEligibleBatches(candidates, { ...request, quantity: (requested / 10_000).toFixed(4) });
        const allocated = result.allocations.reduce((sum, a) => sum + Math.round(a.quantity * 10_000), 0);
        expect(allocated).toBe(Math.min(requested, balances.reduce((sum, balance) => sum + balance, 0)));
        expect(allocated + Math.round(result.shortfallQuantity * 10_000)).toBe(requested);
        for (const allocation of result.allocations) {
          expect(Math.round(allocation.quantity * 10_000)).toBeLessThanOrEqual(balances[Number(allocation.batchId.slice(6))]);
        }
        expect(allocateEligibleBatches([...candidates].reverse(), { ...request, quantity: (requested / 10_000).toFixed(4) })).toEqual(result);
      }), { numRuns: 300, seed: 20261026 });
  });
});
