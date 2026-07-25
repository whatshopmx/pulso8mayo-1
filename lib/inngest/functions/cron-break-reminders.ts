import { inngest } from "@/lib/inngest/client";
import { BreakReminderService } from "@/lib/services/break-reminder-service";

export const cronBreakReminders = inngest.createFunction(
  {
    id: "cron-break-reminders",
    triggers: [{ cron: "0 18 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("check-send-break-reminders", () => BreakReminderService.checkAndSendReminders());
  }
);
