"use server";

import { requireExecutionAccess, assertExecutionInScope } from "@/lib/workflows/execution-access";
import { db } from "@/lib/db";
import { workflowInstances } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resetWorkflowCompletion } from "@/lib/services/workflow-completion-delivery";
import { ApiError } from "@/lib/api/error";
import { z } from "zod";

export async function retryWorkflowCompletionEffects(input: { instanceId: string }) {
  const actor = await requireExecutionAccess("update");
  const { instanceId } = z.object({ instanceId: z.string().uuid() }).parse(input);
  const instance = await db.query.workflowInstances.findFirst({
    where: eq(workflowInstances.id, instanceId),
  });
  if (!instance) throw ApiError.notFound("No encontramos esta ejecución.");
  await assertExecutionInScope(actor, instance);
  // El cron la recoge aunque el navegador cierre o Inngest esté inaccesible.
  return resetWorkflowCompletion(instanceId);
}
