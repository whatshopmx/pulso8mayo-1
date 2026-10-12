import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { WorkflowExecutionService } from '@/lib/services/workflow-execution-service';

vi.mock('@/lib/db', () => ({ db: {
  update: vi.fn(),
  query: {
    workflowInstances: { findFirst: vi.fn() },
    workflowTemplates: { findFirst: vi.fn() },
    workflowInstanceSteps: { findFirst: vi.fn() },
  },
} }));

const row = { itemId: 'pollo', batchId: 'lote-a', name: 'Pollo', sku: 'P', unit: 'kg', lotNumber: 'A', systemQuantity: 4 };
const step = { id: 'conteo', type: 'STOCK_COUNT', config: { category: 'Carnes', rows: [row] } };
const ctx = { kind: 'link', performedBy: 'smart_link:test' } as const;
let saved: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue({ id: 'instance', status: 'IN_PROGRESS', workflowTemplateId: 'template' } as never);
  vi.mocked(db.query.workflowTemplates.findFirst).mockResolvedValue({ steps: [step] } as never);
  vi.mocked(db.query.workflowInstanceSteps.findFirst).mockResolvedValue({ definition: step, status: 'PENDING', value: null } as never);
  vi.mocked(db.update).mockReturnValue({ set: (data: Record<string, unknown>) => {
    saved = data;
    return { where: () => { throw new Error('__saved__'); } };
  } } as never);
});

describe('guardar un bloque de conteo', () => {
  it('guarda un borrador parcial sin cerrar el paso y conserva el stock congelado', async () => {
    await expect(WorkflowExecutionService.updateStep('instance', 'conteo', {
      status: 'IN_PROGRESS', value: JSON.stringify({ rows: [{ ...row, systemQuantity: 100, countedQuantity: null }] }),
    }, ctx)).rejects.toThrow('__saved__');
    expect(saved.status).toBe('IN_PROGRESS');
    expect(JSON.parse(String(saved.value)).rows[0]).toMatchObject({ systemQuantity: 4, countedQuantity: null });
  });
  it('no permite completar pendientes ni omitir el bloque', async () => {
    await expect(WorkflowExecutionService.updateStep('instance', 'conteo', { status: 'COMPLETED', value: '{"rows":[]}' }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    await expect(WorkflowExecutionService.updateStep('instance', 'conteo', { status: 'SKIPPED' }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.update).not.toHaveBeenCalled();
  });
  it('rechaza cambios a un conteo ya completado', async () => {
    vi.mocked(db.query.workflowInstances.findFirst).mockResolvedValue({ id: 'instance', status: 'COMPLETED', workflowTemplateId: 'template' } as never);
    await expect(WorkflowExecutionService.updateStep('instance', 'conteo', { value: '{"rows":[]}' }, ctx)).rejects.toMatchObject({ statusCode: 409 });
    expect(db.update).not.toHaveBeenCalled();
  });
  it('la definición de la instancia gana si se edita la plantilla después', async () => {
    vi.mocked(db.query.workflowTemplates.findFirst).mockResolvedValue({ steps: [{ ...step, config: { rows: [] } }] } as never);
    await expect(WorkflowExecutionService.updateStep('instance', 'conteo', {
      value: { rows: [{ itemId: 'pollo', batchId: 'lote-a', countedQuantity: 0 }] },
    }, ctx)).rejects.toThrow('__saved__');
    expect(JSON.parse(String(saved.value)).rows).toHaveLength(1);
  });
});
