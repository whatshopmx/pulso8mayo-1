import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { StockCountService } from '@/lib/services/stock-count-service';
import { InventoryService } from '@/lib/services/inventory-service';
import { extractStockCountFromInstance } from '@/lib/services/stock-count-from-workflow';

vi.mock('@/lib/db', () => ({ db: { select: vi.fn(), update: vi.fn(), query: {
  workflowInstances: { findFirst: vi.fn() },
  workflowTemplates: { findFirst: vi.fn() }, users: { findMany: vi.fn() },
} } }));
vi.mock('@/lib/services/stock-count-from-workflow', () => ({ extractStockCountFromInstance: vi.fn() }));
const rows = [
  { itemId: 'pollo', batchId: 'a', name: 'Pollo', sku: 'P', unit: 'kg', lotNumber: 'A', systemQuantity: 2, countedQuantity: 1 },
  { itemId: 'pollo', batchId: 'b', name: 'Pollo', sku: 'P', unit: 'kg', lotNumber: 'B', systemQuantity: 3, countedQuantity: 4 },
];
let steps: Record<string, unknown>[];
let saved: Record<string, any>;
beforeEach(() => {
  vi.clearAllMocks();
  steps = [{ stepId: 'carnes', status: 'COMPLETED', definition: { type: 'STOCK_COUNT', config: { category: 'Carnes', rows } }, value: JSON.stringify({ kind: 'stock_count', rows }) }];
  vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue({ id: 'instance', status: 'IN_PROGRESS', data: { stockCountGrid: true } } as never);
  vi.mocked(db.select).mockReturnValue({ from: () => ({ where: async () => steps }) } as never);
  vi.mocked(db.update).mockReturnValue({ set: (value: Record<string, unknown>) => { saved = value; return { where: async () => [] }; } } as never);
});

describe('enviar conteo a revisión', () => {
  it('prepara resultados en la transacción del motor sin adelantar el cierre ni extraer', async () => {
    const txUpdate = vi.fn().mockReturnValue({ set: (value: Record<string, unknown>) => {
      saved = value; return { where: async () => [] };
    } });
    const tx = { query: db.query, select: db.select, update: txUpdate };
    await StockCountService.completeStockCount('instance', 'encargado', tx as never);
    expect(txUpdate).toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(saved.status).toBeUndefined();
    expect(saved.completedAt).toBeUndefined();
    expect(saved.data.adjustmentsStatus).toBe('PENDING');
    expect(extractStockCountFromInstance).not.toHaveBeenCalled();
  });
  it('mantiene diferencias por lote aunque el total del producto coincida, sin mover stock', async () => {
    const movement = vi.spyOn(InventoryService, 'recordMovement');
    await StockCountService.completeStockCount('instance', 'encargado');
    expect(saved.data.results[0]).toMatchObject({ physicalQuantity: 5, systemQuantity: 5, variance: 0 });
    expect(saved.data.lotResults.map((r: { variance: number }) => r.variance)).toEqual([-1, 1]);
    expect(saved.data.adjustmentsStatus).toBe('PENDING');
    expect(movement).not.toHaveBeenCalled();
    movement.mockRestore();
  });
  it('no permite enviar la ejecución mientras otro paso esté pendiente', async () => {
    steps.push({ stepId: 'foto', status: 'PENDING' });
    await expect(StockCountService.completeStockCount('instance', 'encargado')).rejects.toThrow(/pendiente/i);
    expect(db.update).not.toHaveBeenCalled();
  });
  it('no inventa ceros al completar un bloque sin capturar', async () => {
    steps[0].value = JSON.stringify({ kind: 'stock_count', rows: [] });
    await expect(StockCountService.completeStockCount('instance', 'encargado')).rejects.toThrow(/pendiente/i);
    expect(db.update).not.toHaveBeenCalled();
  });
});
