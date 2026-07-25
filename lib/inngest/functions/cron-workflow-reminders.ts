import { inngest } from "@/lib/inngest/client";
import { sendWorkflowReminders } from "@/lib/cron/workflow-reminders";

export const cronWorkflowReminders = inngest.createFunction(
  {
    id: "cron-workflow-reminders",
    triggers: [{ cron: "0 * * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("send-workflow-reminders", () => sendWorkflowReminders());
  }
);
