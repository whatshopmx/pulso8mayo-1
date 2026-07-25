import { inngest } from "@/lib/inngest/client";
import { sendDueSoonReminders } from "@/lib/cron/send-reminders";

export const cronSendReminders = inngest.createFunction(
  {
    id: "cron-send-reminders",
    triggers: [{ cron: "0 8 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("send-due-soon-reminders", () => sendDueSoonReminders());
  }
);
