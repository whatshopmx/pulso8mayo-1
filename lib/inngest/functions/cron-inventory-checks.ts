import { inngest } from "@/lib/inngest/client";
import { checkInventoryAlerts } from "@/lib/cron/inventory-checks";

export const cronInventoryChecks = inngest.createFunction(
  {
    id: "cron-inventory-checks",
    triggers: [{ cron: "0 */6 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("check-inventory-alerts", () => checkInventoryAlerts());
  }
);
