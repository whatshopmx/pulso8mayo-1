import { inngest } from "@/lib/inngest/client";
import { processOverdueWorkflows } from "@/lib/cron/overdue-workflows";

export const cronOverdueWorkflows = inngest.createFunction(
  {
    id: "cron-overdue-workflows",
    triggers: [{ cron: "0 * * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("process-overdue-workflows", () => processOverdueWorkflows());
  }
);
