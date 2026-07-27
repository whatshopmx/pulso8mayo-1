import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { companies, branches, forecastResults } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ForecastService } from "@/lib/services/forecast-service";

export const cronForecastCalculation = inngest.createFunction(
  {
    id: "cron-forecast-calculation",
    triggers: [{ cron: "0 23 * * 0" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("calculate-forecasts", async () => {
      const allCompanies = await db
        .select({ id: companies.id })
        .from(companies);

      let totalForecasts = 0;

      for (const company of allCompanies) {
        const companyBranches = await db
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.companyId, company.id));

        const forecasts = await ForecastService.calculateAll(company.id);

        for (const forecast of forecasts) {
          for (const day of forecast.forecast) {
            for (const branch of companyBranches) {
              await db.insert(forecastResults).values({
                companyId: company.id,
                branchId: branch.id,
                recipeId: forecast.recipeId,
                forecastDate: new Date(day.date),
                predictedQuantity: day.predictedQuantity,
                confidenceScore: day.confidenceScore,
                metadata: {
                  daysOfData: forecast.daysOfData,
                  mape: forecast.mape,
                },
              });
              totalForecasts++;
            }
          }
        }
      }

      return { companies: allCompanies.length, forecasts: totalForecasts };
    });
  }
);
