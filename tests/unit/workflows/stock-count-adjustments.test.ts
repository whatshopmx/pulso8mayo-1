import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { workflowInstances } from '@/lib/db/schema';
import { StockCountService } from '@/lib/services/stock-count-service';
import { InventoryService } from '@/lib/services/inventory-service';

vi.mock('@/lib/db', () => ({ db: { transaction: vi.fn(), query: { workflowInstances: { findFirst: vi.fn() } } } }));
let instance: any;
let stock: Map<string, number>;
let tx: any;
beforeEach(() => {
  vi.restoreAllMocks();
  stock = new Map([['a', 2], ['b', 3]]);
  instance = { id: 'instance', branchId: 'branch', status: 'COMPLETED', data: {
    stockCountGrid: true, adjustmentsStatus: 'PENDING', lotResults: [
      { itemId: 'pollo', batchId: 'a', systemQuantity: 2, physicalQuantity: 1, variance: -1 },
      { itemId: 'pollo', batchId: 'b', systemQuantity: 3, physicalQuantity: 4, variance: 1 },
    ],
  } };
  tx = {
    select: () => ({ from: (table: unknown) => ({ where: () => ({ for: async () =>
      table === workflowInstances ? [instance] : [...stock].map(([id, currentQuantity]) => ({ id, itemId: 'pollo', branchId: 'branch', status: 'AVAILABLE', currentQuantity })),
    }) }) }),
    update: () => ({ set: (saved: any) => ({ where: async () => { instance.data = saved.data; } }) }),
  };
  vi.mocked(db.query.workflowInstances.findFirst).mockImplementation(async () => instance);
  vi.mocked(db.transaction).mockImplementation(async (work: any) => work(tx));
  vi.spyOn(InventoryService, 'recordMovement').mockImplementation(async (movement) => {
    stock.set(movement.batchId!, stock.get(movement.batchId!)! + movement.quantityChange);
    return {} as never;
  });
});

describe('aprobar ajustes del conteo por lote', () => {
  it('aplica cada diferencia al lote contado y una segunda aprobación no mueve stock', async () => {
    await StockCountService.applyStockCountAdjustments('instance', 'gerente');
    expect([...stock]).toEqual([['a', 1], ['b', 4]]);
    expect(instance.data.adjustmentsStatus).toBe('APPLIED');
    await StockCountService.applyStockCountAdjustments('instance', 'gerente');
    expect([...stock]).toEqual([['a', 1], ['b', 4]]);
  });
  it('rechaza la aprobación si un lote contado ya no está disponible', async () => {
    stock.delete('b');
    await expect(StockCountService.applyStockCountAdjustments('instance', 'gerente')).rejects.toMatchObject({ statusCode: 409 });
    expect(instance.data.adjustmentsStatus).toBe('PENDING');
  });
});
