import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ insert: vi.fn(), values: vi.fn(), returning: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { insert: mocks.insert, transaction: async (run: (tx: { insert: typeof mocks.insert }) => unknown) => run({ insert: mocks.insert }) } }));
vi.mock('@/lib/services/inventory-service', () => ({ InventoryService: {} }));
import { StockCountService } from '@/lib/services/stock-count-service';

beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([{ id: 'instance' }]);
  vi.spyOn(StockCountService, 'getActiveCountForBranch').mockResolvedValue(null);
  vi.spyOn(StockCountService, 'getOrCreateTemplate').mockResolvedValue({ id: 'template', steps: [] } as never);
  vi.spyOn(StockCountService, 'getProductsWithStock').mockResolvedValue([{ itemId: 'item', name: 'Producto', sku: 'SKU', unit: 'KG', totalStock: 5 }] as never);
  vi.spyOn(StockCountService, 'resolveCountSteps').mockImplementation(async steps => steps.map(step => ({ ...step, config: { ...step.config, rows: [{ itemId: step.config.category, batchId: null, name: 'Producto', sku: 'SKU', unit: 'KG', lotNumber: null, systemQuantity: 0 }] } })));
});

it('starts inventory counts with one frozen grid per category, including zero-stock products', async () => {
  await StockCountService.createStockCountInstance({ companyId: 'company', branchId: 'branch', assigneeId: 'worker', categoryValue: 'Verduras' });
  expect(StockCountService.resolveCountSteps).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ type: 'STOCK_COUNT', config: { category: 'Verduras', highValueOnly: false } })]), 'company', 'branch');
  expect(mocks.values.mock.calls[0][0].data.stockCountGrid).toBe(true);
  expect(mocks.values.mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'PENDING', value: null, definition: expect.objectContaining({ type: 'STOCK_COUNT', config: { category: 'Verduras', highValueOnly: false, rows: [{ itemId: 'Verduras', batchId: null, name: 'Producto', sku: 'SKU', unit: 'KG', lotNumber: null, systemQuantity: 0 }] } }) })]));
});
