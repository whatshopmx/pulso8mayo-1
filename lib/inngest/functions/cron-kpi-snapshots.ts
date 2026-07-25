import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { companies, kpiDefinitions, kpiSnapshotLogs } from "@/lib/db/schema";
import { kpiCalculator } from "@/lib/services/kpi-calculator";
import { eq, and, isNull } from "drizzle-orm";

async function takeSnapshot(snapshotType: "DAILY" | "WEEKLY" | "MONTHLY"): Promise<{
  companies: number;
  kpis: number;
  stored: number;
}> {
  const now = new Date();
  let totalCompanies = 0;
  let totalKpis = 0;
  let totalStored = 0;

  const allCompanies = await db
    .select({ id: companies.id })
    .from(companies);

  for (const company of allCompanies) {
    const activeKpis = await db
      .select()
      .from(kpiDefinitions)
      .where(
        and(
          eq(kpiDefinitions.companyId, company.id),
          eq(kpiDefinitions.active, true),
          isNull(kpiDefinitions.branchId)
        )
      );

    if (activeKpis.length === 0) continue;

    totalCompanies++;
    totalKpis += activeKpis.length;

    const metrics: Record<string, number> = {};

    for (const kpi of activeKpis) {
      try {
        const value = await kpiCalculator.calculate(
          kpi.formula,
          company.id
        );
        metrics[kpi.id] = value;
      } catch (err) {
        console.warn(
          `[KPI_SNAPSHOT] Failed to calculate KPI ${kpi.id} (${kpi.name}):`,
          err
        );
      }
    }

    if (Object.keys(metrics).length > 0) {
      const periodStart = new Date(now);
      const periodEnd = new Date(now);

      if (snapshotType === "DAILY") {
        periodStart.setHours(0, 0, 0, 0);
      } else if (snapshotType === "WEEKLY") {
        const dayOfWeek = periodStart.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        periodStart.setDate(periodStart.getDate() - diff);
        periodStart.setHours(0, 0, 0, 0);
        periodEnd.setDate(periodStart.getDate() + 6);
        periodEnd.setHours(23, 59, 59, 999);
      } else {
        periodStart.setDate(1);
        periodStart.setHours(0, 0, 0, 0);
        periodEnd.setMonth(periodEnd.getMonth() + 1, 0);
        periodEnd.setHours(23, 59, 59, 999);
      }

      await db.insert(kpiSnapshotLogs).values({
        companyId: company.id,
        snapshotType,
        snapshotDate: now,
        metrics,
        periodStart,
        periodEnd,
      });

      totalStored++;
    }
  }

  return { companies: totalCompanies, kpis: totalKpis, stored: totalStored };
}

export const cronKpiSnapshotsDaily = inngest.createFunction(
  {
    id: "cron-kpi-snapshots-daily",
    triggers: [{ cron: "0 23 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("take-daily-snapshot", () => takeSnapshot("DAILY"));
  }
);

export const cronKpiSnapshotsWeekly = inngest.createFunction(
  {
    id: "cron-kpi-snapshots-weekly",
    triggers: [{ cron: "0 22 * * 0" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("take-weekly-snapshot", () => takeSnapshot("WEEKLY"));
  }
);

export const cronKpiSnapshotsMonthly = inngest.createFunction(
  {
    id: "cron-kpi-snapshots-monthly",
    triggers: [{ cron: "0 21 28-31 * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("take-monthly-snapshot", () => takeSnapshot("MONTHLY"));
  }
);
