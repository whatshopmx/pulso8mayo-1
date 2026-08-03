// M13 / T33: Inngest Cron Sales Cut Reminder
// Periodically checks if active branches have registered their daily sales cut.
// If missing, dispatches a notification with a Smart Link to the PWA upload page.

import { inngest } from "../client";
import { db } from "@/lib/db";
import { branches, dailySalesCuts, users } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

export const cronSalesCutReminder = inngest.createFunction(
  {
    id: "cron-sales-cut-reminder",
    triggers: [{ cron: "0 * * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    // 1. Fetch active branches
    const activeBranches = await step.run("fetch-branches", async () => {
      return db
        .select({
          id: branches.id,
          name: branches.name,
          companyId: branches.companyId,
          managerId: branches.managerId,
        })
        .from(branches);
    });

    if (activeBranches.length === 0) return { checked: 0 };

    const todayStr = new Date().toISOString().slice(0, 10);
    let missingCount = 0;

    for (const branch of activeBranches) {
      await step.run(`check-sales-cut-${branch.id}`, async () => {
        // Check if cut exists for today
        const existing = await db
          .select({ id: dailySalesCuts.id })
          .from(dailySalesCuts)
          .where(
            and(
              eq(dailySalesCuts.companyId, branch.companyId),
              eq(dailySalesCuts.branchId, branch.id),
              eq(dailySalesCuts.businessDate, todayStr)
            )
          )
          .limit(1);

        if (existing.length === 0 && branch.managerId) {
          missingCount++;

          const smartLinkUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/sales?branchId=${branch.id}`;

          await NotificationDispatcher.sendNotification({
            userId: branch.managerId,
            title: "💰 Alerta: Corte de Caja Faltante",
            message: `El corte de ventas de la sucursal ${branch.name} para hoy (${todayStr}) aún no se ha registrado.`,
            type: "warning",
            eventType: "sales_cut_missing",
            actionUrl: `/dashboard/sales?branchId=${branch.id}`,
            actionLabel: "Subir Corte",
            metadata: {
              branchName: branch.name,
              shift: "COMPLETO",
              businessDate: todayStr,
              smartLinkUrl,
            },
          });
        }
      });
    }

    return { checked: activeBranches.length, missingCount };
  }
);
