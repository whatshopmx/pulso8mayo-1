import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { workflowInstances, workflowCompletionOutbox } from '@/lib/db/schema';
import { WorkflowExecutionService } from '@/lib/services/workflow-execution-service';
import { extractStockCountFromInstance } from '@/lib/services/stock-count-from-workflow';

vi.mock('@/lib/db', () => ({ db: {
  query: { workflowInstances: { findFirst: vi.fn() }, workflowInstanceSteps: { findMany: vi.fn() } },
  select: vi.fn(), update: vi.fn(), insert: vi.fn(), transaction: vi.fn(), execute: vi.fn(),
} }));
vi.mock('@/lib/services/workflow-action-runner', () => ({ WorkflowActionRunner: { runCompletionActions: vi.fn() } }));
vi.mock('@/lib/services/smart-link-service', () => ({ SmartLinkService: { markUsedForInstance: vi.fn() } }));
vi.mock('@/lib/services/incident-engine', () => ({ IncidentEngine: { hasBlockingIncidents: vi.fn().mockResolvedValue(false) } }));
vi.mock('@/lib/services/stock-count-from-workflow', () => ({ extractStockCountFromInstance: vi.fn() }));

const rows = [{ itemId: 'pollo', batchId: 'lote', name: 'Pollo', sku: 'P', unit: 'kg', systemQuantity: 2, countedQuantity: 2 }];
const steps = [{ stepId: 'carnes', status: 'COMPLETED', definition: { type: 'STOCK_COUNT', config: { category: 'Carnes', rows } },
  value: JSON.stringify({ kind: 'stock_count', rows }) }];
let instance: Record<string, any>;
let outbox: Record<string, unknown>[];
let rejectOutbox: boolean;
let tail: Promise<unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  instance = { id: 'count', status: 'IN_PROGRESS', data: { stockCountGrid: true }, assigneeId: 'user' };
  outbox = [];
  rejectOutbox = false;
  tail = Promise.resolve();
  vi.mocked(db.query.workflowInstances.findFirst).mockImplementation(async () => structuredClone(instance) as never);
  vi.mocked(db.query.workflowInstanceSteps.findMany).mockResolvedValue(steps as never);
  vi.mocked(db.select).mockReturnValue({ from: () => ({ where: async () => steps }) } as never);
  vi.mocked(db.execute).mockResolvedValue([] as never);
  vi.mocked(db.update).mockImplementation((table: unknown) => ({ set: (patch: Record<string, unknown>) => ({ where: () => {
    expect(table).toBe(workflowInstances);
    const updated = patch.status === 'COMPLETED' && instance.status === 'COMPLETED' ? [] : [instance];
    if (updated.length) Object.assign(instance, patch);
    return Object.assign(Promise.resolve(updated), { returning: async () => updated });
  } }) }) as never);
  vi.mocked(db.insert).mockImplementation((table: unknown) => ({ values: async (value: Record<string, unknown>) => {
    expect(table).toBe(workflowCompletionOutbox);
    if (rejectOutbox) throw new Error('outbox no disponible');
    outbox.push(value);
  } }) as never);
  vi.mocked(db.transaction).mockImplementation((async (callback: (tx: typeof db) => Promise<unknown>) => {
    const prior = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await prior;
    const snapshot = structuredClone({ instance, outbox });
    try { return await callback(db); }
    catch (error) { instance = snapshot.instance; outbox = snapshot.outbox; throw error; }
    finally { release(); }
  }) as never);
});

it('el conteo real confirma resultados, estado y una intención en la misma transacción', async () => {
  const result = await WorkflowExecutionService.recalculateProgress('count', 'user');
  expect(result.completed).toBe(true);
  expect(instance).toMatchObject({ status: 'COMPLETED', completionEffectsStatus: 'pending',
    data: { results: [{ physicalQuantity: 2, variance: 0 }], adjustmentsStatus: 'NONE' } });
  expect(outbox).toHaveLength(1);
  expect(extractStockCountFromInstance).not.toHaveBeenCalled();
});

it('fallar al guardar outbox revierte también los resultados del conteo real', async () => {
  rejectOutbox = true;
  await expect(WorkflowExecutionService.recalculateProgress('count', 'user')).rejects.toThrow('outbox no disponible');
  expect(instance).toMatchObject({ status: 'IN_PROGRESS', data: { stockCountGrid: true } });
  expect(instance.data.results).toBeUndefined();
  expect(instance.completionEffectsStatus).toBeUndefined();
  expect(outbox).toHaveLength(0);
  expect(extractStockCountFromInstance).not.toHaveBeenCalled();
});

it('dos cierres concurrentes conservan una sola intención y los resultados', async () => {
  const results = await Promise.all([WorkflowExecutionService.recalculateProgress('count'), WorkflowExecutionService.recalculateProgress('count')]);
  expect(results.filter(r => r.completed)).toHaveLength(1);
  expect(results.filter(r => r.alreadyCompleted)).toHaveLength(1);
  expect(instance.data.results).toHaveLength(1);
  expect(outbox).toHaveLength(1);
});
