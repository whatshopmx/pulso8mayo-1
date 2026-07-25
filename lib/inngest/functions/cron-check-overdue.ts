import { inngest } from "@/lib/inngest/client";
import { checkOverdueAssignments } from "@/lib/cron/check-overdue";

export const cronCheckOverdue = inngest.createFunction(
  {
    id: "cron-check-overdue",
    triggers: [{ cron: "0 * * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("check-overdue-assignments", () => checkOverdueAssignments());
  }
);
