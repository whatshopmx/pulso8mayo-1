// M13 / T31: Inngest Cron — Financial KPI Alerts
// Every morning at 8 AM, scans branches with registered sales,
// computes Food Cost % and Labor Cost %, and notifies if thresholds breached.

import { inngest } from "../client";
import { db } from "@/lib/db";
import { branches, dailySalesCuts } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { calculateFinancialKPIs } from "@/lib/services/financial-kpi-service";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

export const checkFinancialAlerts = inngest.createFunction(
  {
    id: "check-financial-alerts",
    triggers: [{ cron: "0 8 * * *" }], // Every day at 8:00 AM
    retries: 2,
  },
  async ({ step }) => {
    // 1. Find branches that had sales in the last 7 days
    const activeBranches = await step.run("fetch-active-branches", async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

      // Get branches with sales in the period
      const rows = await db
        .select({
          branchId: dailySalesCuts.branchId,
          companyId: dailySalesCuts.companyId,
        })
        .from(dailySalesCuts)
        .where(sql`${dailySalesCuts.businessDate} >= ${cutoff}`)
        .groupBy(dailySalesCuts.branchId, dailySalesCuts.companyId);

      // Enrich with branch names
      const branchIds = rows.map((r) => r.branchId);
      if (branchIds.length === 0) return [];

      const branchRows = await db
        .select({
          id: branches.id,
          name: branches.name,
          companyId: branches.companyId,
        })
        .from(branches)
        .where(sql`${branches.id} IN ${branchIds}`);

      return branchRows;
    });

    if (activeBranches.length === 0) {
      return { checked: 0, alerts: 0 };
    }

    let alertsSent = 0;

    for (const branch of activeBranches) {
      await step.run(`check-kpi-${branch.id}`, async () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const startDate = new Date(yesterday);
        startDate.setDate(startDate.getDate() - 6); // Last 7 days window

        const kpis = await calculateFinancialKPIs({
          companyId: branch.companyId,
          branchId: branch.id,
          startDate: startDate.toISOString().slice(0, 10),
          endDate: yesterday.toISOString().slice(0, 10),
        });

        const alerts: string[] = [];

        // Critical alerts → notify Owner + Director Ops
        if (kpis.foodCostStatus === "CRITICAL") {
          alerts.push(
            `🚨 Food Cost de ${branch.name} subió a ${kpis.foodCostPercent}% (objetivo: <30%). Revisa merma y recepción de mercancía.`
          );
        }

        if (kpis.laborCostStatus === "CRITICAL") {
          alerts.push(
            `🚨 Labor Cost de ${branch.name} subió a ${kpis.laborCostPercent}% (objetivo: <28%). Revisa horas extra y staffing.`
          );
        }

        // Warning alerts → notify Director Ops only
        if (kpis.foodCostStatus === "WARNING") {
          alerts.push(
            `⚠️ Food Cost de ${branch.name} está en ${kpis.foodCostPercent}% — cerca del límite (30%). Monitorea la recepción de insumos.`
          );
        }

        if (kpis.laborCostStatus === "WARNING") {
          alerts.push(
            `⚠️ Labor Cost de ${branch.name} está en ${kpis.laborCostPercent}% — cerca del límite (28%). Revisa el plan de turnos.`
          );
        }

        // Send alerts
        for (const alert of alerts) {
          const isCritical = alert.startsWith("🚨");
          try {
            await NotificationDispatcher.sendNotification({
              userId: branch.companyId,
              title: isCritical
                ? "🚨 Alerta Crítica de Rentabilidad"
                : "⚠️ Advertencia de Costos Operativos",
              message: alert,
              type: isCritical ? "warning" : "info",
              eventType: "financial_kpi_deviation",
              actionUrl: `/dashboard/sales?branchId=${branch.id}`,
              actionLabel: "Ver Dashboard",
              metadata: {
                branchName: branch.name,
                branchId: branch.id,
                foodCostPercent: kpis.foodCostPercent,
                foodCostStatus: kpis.foodCostStatus,
                laborCostPercent: kpis.laborCostPercent,
                laborCostStatus: kpis.laborCostStatus,
                healthyMarginPercent: kpis.healthyMarginPercent,
              },
            });
            alertsSent++;
          } catch (err) {
            console.warn(
              `[checkFinancialAlerts] Failed to send alert for ${branch.name}:`,
              err
            );
          }
        }
      });
    }

    return { checked: activeBranches.length, alertsSent };
  }
);
