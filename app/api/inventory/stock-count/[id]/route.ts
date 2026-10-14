import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { StockCountService, STOCK_COUNT_TEMPLATE_NAME } from '@/lib/services/stock-count-service';
import { WorkflowExecutionService } from '@/lib/services/workflow-execution-service';
import { db } from '@/lib/db';
import { workflowInstances, workflowInstanceSteps, workflowTemplates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { ApiError, isApiError } from '@/lib/api/error';
import { requireExecutionAccess, requireReviewAccess, assertExecutionInScope, type ExecutionActor } from '@/lib/workflows/execution-access';

interface RouteParams { params: Promise<{ id: string }> }
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete') }),
  z.object({ action: z.literal('applyAdjustments') }),
  z.object({ action: z.literal('updateStep'), stepId: z.string().min(1), value: z.unknown() }),
]);

async function loadCount(id: string, actor: ExecutionActor) {
  const instance = await db.query.workflowInstances.findFirst({ where: eq(workflowInstances.id, id) });
  if (!instance) throw ApiError.notFound('Conteo no encontrado');
  await assertExecutionInScope(actor, instance);
  const template = await db.query.workflowTemplates.findFirst({ where: eq(workflowTemplates.id, instance.workflowTemplateId) });
  if (!(instance.data as { stockCountGrid?: boolean })?.stockCountGrid && template?.name !== STOCK_COUNT_TEMPLATE_NAME) throw ApiError.notFound('Conteo no encontrado');
  return { ...instance, templateName: template?.name || '' };
}

function failure(error: unknown) {
  const status = isApiError(error) ? error.statusCode : error instanceof z.ZodError ? 400 : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo procesar el conteo' }, { status });
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const actor = await requireExecutionAccess('read');
    const { id } = await params;
    const instance = await loadCount(id, actor);
    const steps = await db.select().from(workflowInstanceSteps).where(eq(workflowInstanceSteps.instanceId, id));
    return NextResponse.json({ instance, steps });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actor = await requireExecutionAccess('update');
    const body = actionSchema.parse(await request.json());
    const reviewer = body.action === 'applyAdjustments' ? await requireReviewAccess() : actor;
    const { id } = await params;
    await loadCount(id, reviewer);
    if (body.action === 'applyAdjustments') return NextResponse.json(await StockCountService.applyStockCountAdjustments(id, reviewer.userId));
    if (body.action === 'complete') return NextResponse.json(await StockCountService.completeStockCount(id, actor.userId));
    const result = await WorkflowExecutionService.updateStep(id, body.stepId, { value: body.value, status: 'COMPLETED' }, { kind: 'session', actor, performedBy: actor.userId });
    return NextResponse.json(result);
  } catch (error) { return failure(error); }
}
