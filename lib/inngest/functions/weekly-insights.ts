import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { InsightGeneratorService } from "@/lib/services/insight-generator-service";

export const weeklyInsights = inngest.createFunction(
  {
    id: "weekly-insights",
    triggers: [{ cron: "0 7 * * 1" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("generate-weekly-insights", async () => {
      const allCompanies = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies);

      let totalInsights = 0;
      const results: { company: string; insights: number }[] = [];

      for (const company of allCompanies) {
        const insights = await InsightGeneratorService.generateForCompany(company.id);
        if (insights.length > 0) {
          await InsightGeneratorService.notifyInsights(company.id, insights);
          totalInsights += insights.length;
          results.push({ company: company.name, insights: insights.length });
        }
      }

      return {
        companies: allCompanies.length,
        totalInsights,
        details: results,
      };
    });
  }
);
