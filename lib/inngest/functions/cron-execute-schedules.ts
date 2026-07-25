import { inngest } from "@/lib/inngest/client";
import { executeScheduledWorkflows } from "@/lib/cron/execute-schedules";

export const cronExecuteSchedules = inngest.createFunction(
  {
    id: "cron-execute-schedules",
    triggers: [{ cron: "*/5 * * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("execute-scheduled-workflows", () => executeScheduledWorkflows());
  }
);
