import { inngest } from "@/lib/inngest/client";
import { PerformanceReminderService } from "@/lib/services/performance-reminder-service";

export const cronPerformanceReminders = inngest.createFunction(
  {
    id: "cron-performance-reminders",
    triggers: [{ cron: "0 9 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run(
      "check-send-performance-reminders",
      () => PerformanceReminderService.checkAndSendReminders()
    );
  }
);