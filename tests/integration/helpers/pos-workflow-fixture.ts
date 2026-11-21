import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { workflowTemplates, workflowInstances, workflowInstanceSteps } from '@/lib/db/schema';
import type { createSalesRuntimeDatabase } from './sales-runtime-database';

/** A second uncompleted step prevents completion jobs/notifications in this fixture. */
export async function seedPosWorkflow(database: Awaited<ReturnType<typeof createSalesRuntimeDatabase>>, scope: { companyId: string; branchId: string; actorId: string }) {
  const templateId = randomUUID(), instanceId = randomUUID();
  const definitions = [
    { id: 'pos', type: 'TEXT', title: 'Subir archivo del POS', description: 'Cierre sintético con writer runtime', required: true, config: { posUpload: true } },
    { id: 'review', type: 'INFO', title: 'Revisión final sintética', required: false },
  ];
  await database.owner.transaction(async tx => {
    await tx.insert(workflowTemplates).values({ id: templateId, companyId: scope.companyId, branchId: scope.branchId,
      name: 'Cierre POS sintético', steps: definitions, category: 'FINANZAS', completionActions: [] });
    await tx.insert(workflowInstances).values({ id: instanceId, workflowTemplateId: templateId, branchId: scope.branchId,
      assigneeId: scope.actorId, status: 'IN_PROGRESS', currentStepId: 'pos' });
    await tx.insert(workflowInstanceSteps).values(definitions.map((definition, stepOrder) => ({ instanceId, stepId: definition.id,
      status: 'PENDING', stepOrder, type: definition.type, title: definition.title, definition })));
  });
  const state = async () => {
    const [step] = await database.owner.select().from(workflowInstanceSteps)
      .where(and(eq(workflowInstanceSteps.instanceId, instanceId), eq(workflowInstanceSteps.stepId, 'pos')));
    const [instance] = await database.owner.select({ status: workflowInstances.status }).from(workflowInstances).where(eq(workflowInstances.id, instanceId));
    return { step, instance };
  };
  return { instanceId, state };
}
