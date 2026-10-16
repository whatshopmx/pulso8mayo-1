/** C28: fixtures propias en Neon; no publica eventos ni envía notificaciones. */
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import assert from 'node:assert/strict';
config({ quiet: true });

async function main() {
  const { db } = await import('@/lib/db');
  const s = await import('@/lib/db/schema');
  const { WorkflowExecutionService } = await import('@/lib/services/workflow-execution-service');
  const { StockCountService } = await import('@/lib/services/stock-count-service');
  const { runCompletionExtractor, setWorkflowExtractionStatus, resetWorkflowCompletion } = await import('@/lib/services/workflow-completion-delivery');
  const { extractStockCountFromInstance } = await import('@/lib/services/stock-count-from-workflow');
  const companyId = randomUUID(), branchId = randomUUID(), userId = randomUUID();
  const templateId = randomUUID(), instanceId = randomUUID(), itemId = randomUUID();
  const tag = `[VERIFY-C28-${instanceId}]`;
  const rows = [{ itemId, batchId: null, name: 'Pollo C28', sku: 'C28', unit: 'kg', systemQuantity: 2, countedQuantity: 2 }];
  const definition = { id: 'conteo', type: 'STOCK_COUNT', required: true, config: { category: 'Carnes', rows } };
  let checks = 0;
  const check = (condition: unknown) => { assert.ok(condition); checks++; };
  try {
    await db.insert(s.companies).values({ id: companyId, name: tag });
    await db.insert(s.branches).values({ id: branchId, companyId, name: tag, code: 'C28' });
    await db.insert(s.users).values({ id: userId, companyId, branchId, name: tag, email: `${userId}@example.invalid`, role: 'EMPLEADO',
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(s.inventoryItems).values({ id: itemId, companyId, name: tag, unit: 'kg', category: 'Carnes' });
    await db.insert(s.workflowTemplates).values({ id: templateId, companyId, name: tag, steps: [definition], completionActions: [] });
    await db.insert(s.workflowInstances).values({ id: instanceId, workflowTemplateId: templateId, branchId, assigneeId: userId,
      status: 'IN_PROGRESS', data: { stockCountGrid: true } });
    await db.insert(s.workflowInstanceSteps).values({ instanceId, stepId: 'conteo', status: 'COMPLETED', definition,
      value: JSON.stringify({ kind: 'stock_count', rows }) });
    // Rollback real: ni resultados preparados ni intención sobreviven a una caída.
    await assert.rejects(db.transaction(async tx => {
      await StockCountService.completeStockCount(instanceId, userId, tx);
      await tx.insert(s.workflowCompletionOutbox).values({ instanceId, intent: 'workflow/instance.completed' });
      throw new Error('caída controlada antes del commit');
    }), /caída controlada/);
    const before = await db.query.workflowInstances.findFirst({ where: eq(s.workflowInstances.id, instanceId) });
    check(before?.status === 'IN_PROGRESS' && !(before.data as Record<string, unknown>).results);
    check((await db.select().from(s.workflowCompletionOutbox).where(eq(s.workflowCompletionOutbox.instanceId, instanceId))).length === 0);
    const results = await Promise.all([WorkflowExecutionService.recalculateProgress(instanceId, userId),
      WorkflowExecutionService.recalculateProgress(instanceId, userId)]);
    check(results.filter(r => r.completed).length === 1);
    check(results.filter(r => r.alreadyCompleted).length === 1);
    const completed = await db.query.workflowInstances.findFirst({ where: eq(s.workflowInstances.id, instanceId) });
    check(completed?.status === 'COMPLETED' && completed.completionEffectsStatus === 'pending');
    check(Array.isArray((completed?.data as Record<string, unknown>).results));
    check((await db.select().from(s.workflowCompletionOutbox).where(eq(s.workflowCompletionOutbox.instanceId, instanceId))).length === 1);
    await Promise.all([runCompletionExtractor(instanceId, 'stock-count', extractStockCountFromInstance, 0),
      runCompletionExtractor(instanceId, 'stock-count', extractStockCountFromInstance, 0)]);
    check((await db.select().from(s.stockCounts).where(eq(s.stockCounts.workflowInstanceId, instanceId))).length === 1);
    await setWorkflowExtractionStatus(instanceId, 'failed', 0);
    await Promise.all([resetWorkflowCompletion(instanceId), resetWorkflowCompletion(instanceId)]);
    const [recovered] = await db.select().from(s.workflowCompletionOutbox).where(eq(s.workflowCompletionOutbox.instanceId, instanceId));
    check(recovered.generation === 1 && recovered.completedExtractors.includes('stock-count'));
    let repeated = false;
    await runCompletionExtractor(instanceId, 'stock-count', async () => { repeated = true; }, 1);
    check(!repeated);
    await setWorkflowExtractionStatus(instanceId, 'failed', 0);
    const current = await db.query.workflowInstances.findFirst({ where: eq(s.workflowInstances.id, instanceId) });
    check(current?.completionEffectsStatus === 'pending');
    console.log(`C28: ${checks} comprobaciones aprobadas en Neon; sin eventos ni mensajes externos.`);
  } finally {
    await db.delete(s.stockCounts).where(eq(s.stockCounts.workflowInstanceId, instanceId));
    await db.delete(s.workflowCompletionOutbox).where(eq(s.workflowCompletionOutbox.instanceId, instanceId));
    await db.delete(s.workflowInstanceSteps).where(eq(s.workflowInstanceSteps.instanceId, instanceId));
    await db.delete(s.workflowInstances).where(eq(s.workflowInstances.id, instanceId));
    await db.delete(s.workflowTemplates).where(eq(s.workflowTemplates.id, templateId));
    await db.delete(s.inventoryItems).where(eq(s.inventoryItems.id, itemId));
    await db.delete(s.users).where(eq(s.users.id, userId));
    await db.delete(s.branches).where(eq(s.branches.id, branchId));
    await db.delete(s.companies).where(eq(s.companies.id, companyId));
    console.log('Fixtures C28 eliminadas por sus UUID propios.');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
