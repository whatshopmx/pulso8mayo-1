import { beforeEach, expect, it, vi } from 'vitest';

/**
 * B1 — captura previa al crear la instancia.
 *
 * La pantalla de conteo puede capturar cantidades antes de crear el conteo.
 * El servicio NO confía en las filas del cliente: re-resuelve el alcance y
 * valida el valor contra las filas congeladas con `normalizeStockCount`. Una
 * fila ajena o duplicada aborta sin escribir.
 */
const mocks = vi.hoisted(() => ({ insert: vi.fn(), values: vi.fn(), returning: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: {
    insert: mocks.insert,
    transaction: async (run: (tx: { insert: typeof mocks.insert }) => unknown) => run({ insert: mocks.insert }),
  },
}));
vi.mock('@/lib/services/inventory-service', () => ({ InventoryService: {} }));

import { StockCountService } from '@/lib/services/stock-count-service';

const ROW = { itemId: 'Verduras', batchId: null, name: 'Producto', sku: 'SKU', unit: 'KG', lotNumber: null, systemQuantity: 0 };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([{ id: 'instance' }]);
  vi.spyOn(StockCountService, 'getActiveCountForBranch').mockResolvedValue(null);
  vi.spyOn(StockCountService, 'getOrCreateTemplate').mockResolvedValue({ id: 'template', steps: [] } as never);
  vi.spyOn(StockCountService, 'resolveCountSteps').mockImplementation(async steps =>
    steps.map(step => ({ ...step, config: { ...step.config, rows: [{ ...ROW, itemId: step.config.category }] } })));
});

function insertedSteps() {
  return mocks.values.mock.calls[1][0] as Array<{ stepId: string; value: string | null }>;
}

it('guarda la captura previa validada en el paso de la categoría', async () => {
  await StockCountService.createStockCountInstance({
    companyId: 'company', branchId: 'branch', assigneeId: 'worker', categoryValue: 'Verduras',
    initialValues: {
      Verduras: JSON.stringify({ kind: 'stock_count', rows: [{ itemId: 'Verduras', batchId: null, countedQuantity: '2.5' }] }),
    },
  });

  const [step] = insertedSteps();
  const value = JSON.parse(step.value as string);
  expect(value.kind).toBe('stock_count');
  expect(value.rows[0]).toMatchObject({ itemId: 'Verduras', batchId: null, countedQuantity: 2.5 });
});

it('sin captura previa deja el paso pendiente (value null)', async () => {
  await StockCountService.createStockCountInstance({ companyId: 'company', branchId: 'branch', assigneeId: 'worker', categoryValue: 'Verduras' });
  const [step] = insertedSteps();
  expect(step.value).toBeNull();
});

it('rechaza una fila que no pertenece al conteo sin crear la instancia', async () => {
  await expect(StockCountService.createStockCountInstance({
    companyId: 'company', branchId: 'branch', assigneeId: 'worker', categoryValue: 'Verduras',
    initialValues: {
      Verduras: JSON.stringify({ kind: 'stock_count', rows: [{ itemId: 'ajeno', batchId: null, countedQuantity: '1' }] }),
    },
  })).rejects.toThrow(/no pertenece al conteo/i);

  expect(mocks.insert).not.toHaveBeenCalled();
});
