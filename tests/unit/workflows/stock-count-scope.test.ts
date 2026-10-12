import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockCountService } from '@/lib/services/stock-count-service';

vi.mock('@/lib/db', () => ({ db: {} }));
const rows = [{ itemId: 'pollo', batchId: 'a', name: 'Pollo', sku: 'P', unit: 'kg', lotNumber: 'A', systemQuantity: 2 }];
afterEach(() => vi.restoreAllMocks());

describe('resolver categorías al iniciar el workflow', () => {
  it('resuelve el catálogo real de cada categoría y reemplaza filas enviadas por la plantilla', async () => {
    const getRows = vi.spyOn(StockCountService, 'getCountRows').mockResolvedValue(rows);
    const input = [{ id: 'carnes', type: 'STOCK_COUNT', title: 'Carnes', required: true, config: { category: 'Carnes', rows: [] } }];
    const steps = await StockCountService.resolveCountSteps(input, 'empresa', 'sucursal');
    expect(steps[0].config.rows).toEqual(rows);
    expect(getRows).toHaveBeenCalledWith('empresa', 'sucursal', 'Carnes', false);
    expect(input[0].config.rows).toEqual([]);
  });
  it('no crea un conteo vacío y exige una categoría real', async () => {
    vi.spyOn(StockCountService, 'getCountRows').mockResolvedValue([]);
    await expect(StockCountService.resolveCountSteps([{ type: 'STOCK_COUNT', config: { category: 'Vacía' } }], 'empresa', 'sucursal')).rejects.toMatchObject({ statusCode: 400 });
    await expect(StockCountService.resolveCountSteps([{ type: 'STOCK_COUNT', config: {} }], 'empresa', 'sucursal')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('rechaza contar dos veces el mismo producto y lote en una ejecución', async () => {
    vi.spyOn(StockCountService, 'getCountRows').mockResolvedValue(rows);
    const step = { type: 'STOCK_COUNT', config: { category: 'Carnes' } };
    await expect(StockCountService.resolveCountSteps([step, step], 'empresa', 'sucursal')).rejects.toMatchObject({ statusCode: 400 });
  });
});
