import { inngest } from "@/lib/inngest/client";
import { pendingWorkflowCompletions, publishWorkflowCompletion } from "@/lib/services/workflow-completion-delivery";

export const workflowCompletionRecoveryFn = inngest.createFunction(
  {
    id: "workflow-completion-recovery",
    triggers: [{ cron: "* * * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    const rows = await step.run("pending-completion-outbox", pendingWorkflowCompletions);
    for (const { instanceId } of rows) {
      await step.run(`publish-${instanceId}`, () => publishWorkflowCompletion(instanceId));
    }
    return { attempted: rows.length };
  },
);
