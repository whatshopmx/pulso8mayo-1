import { inngest } from "@/lib/inngest/client";
import { complianceAlertService } from "@/lib/services/compliance-alert-service";

export const cronComplianceAlerts = inngest.createFunction(
  {
    id: "cron-compliance-alerts",
    triggers: [{ cron: "0 */6 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("evaluate-compliance-alerts", async () => {
      const result = await complianceAlertService.evaluateAndGenerateAlerts();
      const resolved = await complianceAlertService.autoResolveAlerts();
      return { ...result, alertsResolved: resolved };
    });
  }
);
