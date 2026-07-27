import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { companies, branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { AdvancedAlertService } from "@/lib/services/advanced-alert-service";

export const cronAdvancedAlerts = inngest.createFunction(
  {
    id: "cron-advanced-alerts",
    triggers: [{ cron: "0 */6 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("run-advanced-alerts", async () => {
      const allCompanies = await db
        .select({ id: companies.id })
        .from(companies);

      let highVarianceCount = 0;
      let anomalousWasteCount = 0;
      let yieldDropCount = 0;

      for (const company of allCompanies) {
        const companyBranches = await db
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.companyId, company.id));

        for (const branch of companyBranches) {
          await AdvancedAlertService.checkHighVariance(company.id, branch.id);
          highVarianceCount++;

          await AdvancedAlertService.checkAnomalousWaste(company.id, branch.id);
          anomalousWasteCount++;

          await AdvancedAlertService.checkYieldDrop(company.id, branch.id);
          yieldDropCount++;
        }
      }

      return {
        companies: allCompanies.length,
        highVarianceChecked: highVarianceCount,
        anomalousWasteChecked: anomalousWasteCount,
        yieldDropChecked: yieldDropCount,
      };
    });
  }
);
