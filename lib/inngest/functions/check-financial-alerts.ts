// M13 / T31: Inngest Cron — Alertas de desviación de costos.
//
// Cada mañana revisa las sucursales con venta reciente, calcula Food Cost % y
// Labor Cost % sobre la ventana de 7 días y avisa cuando se rompe el umbral
// del grupo.
//
// Dos correcciones respecto de la versión anterior:
//
//  1. Los destinatarios se resuelven a usuarios reales. Antes se pasaba
//     `userId: branch.companyId` — un id de empresa en el campo de usuario.
//     `NotificationDispatcher.sendNotification` arranca con
//     `getUserPreferences(payload.userId)` y sale temprano si no encuentra
//     fila, así que TODAS las alertas de este cron se descartaban en silencio:
//     el job corría, calculaba y no entregaba nada.
//  2. Los umbrales salen del tenant (`getFinancialTargets`), no de un "<30%"
//     escrito en el texto del mensaje. Un grupo que configuró 26% ya no lee
//     una alerta que le cita un objetivo que no es el suyo.
//
// Cuando un KPI no es calculable (sin movimientos de inventario, sin contratos)
// el status llega en `null` y NO se alerta: la ausencia de dato es un problema
// de captura, no una desviación de costo, y merece otro mensaje.

import { inngest } from "../client";
import { db } from "@/lib/db";
import { branches, dailySalesCuts, users } from "@/lib/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import { calculateFinancialKPIs } from "@/lib/services/financial-kpi-service";
import { getFinancialTargets } from "@/lib/services/tenant-config-service";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

/**
 * Quién recibe una desviación de rentabilidad: dirección, no el turno.
 *
 * El diseño §3 nombra un "Director de Operaciones", pero `users.role` no tiene
 * `DIRECTOR_OPS` — esa etiqueta solo existe en `expense_authorization_rules`.
 * En el enum de usuarios el equivalente es ADMIN, que es también el criterio
 * que usa `generate-morning-brief`.
 */
const ALERT_RECIPIENT_ROLES = ["OWNER", "ADMIN"] as const;

export const checkFinancialAlerts = inngest.createFunction(
  {
    id: "check-financial-alerts",
    triggers: [{ cron: "0 8 * * *" }], // Todos los días a las 8:00
    retries: 2,
  },
  async ({ step }) => {
    // 1. Sucursales con venta en los últimos 7 días.
    const activeBranches = await step.run("fetch-active-branches", async () => {
      const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

      const rows = await db
        .select({ branchId: dailySalesCuts.branchId })
        .from(dailySalesCuts)
        .where(gte(dailySalesCuts.businessDate, cutoff))
        .groupBy(dailySalesCuts.branchId);

      const branchIds = rows.map((r) => r.branchId);
      if (branchIds.length === 0) return [];

      // `inArray`, no `sql\`IN ${branchIds}\``: la interpolación de un array
      // en template SQL no produce una lista IN válida en Drizzle.
      return db
        .select({ id: branches.id, name: branches.name, companyId: branches.companyId })
        .from(branches)
        .where(inArray(branches.id, branchIds));
    });

    if (activeBranches.length === 0) {
      return { checked: 0, alertsSent: 0 };
    }

    // 2. Destinatarios por empresa, resueltos una sola vez.
    const companyIds = [...new Set(activeBranches.map((b) => b.companyId))];

    const recipientsByCompany = await step.run("fetch-recipients", async () => {
      const rows = await db
        .select({ id: users.id, companyId: users.companyId })
        .from(users)
        .where(
          and(
            inArray(users.companyId, companyIds),
            inArray(users.role, [...ALERT_RECIPIENT_ROLES]),
            eq(users.active, true),
          ),
        );

      const map: Record<string, string[]> = {};
      for (const row of rows) {
        if (!row.companyId) continue;
        (map[row.companyId] ??= []).push(row.id);
      }
      return map;
    });

    let alertsSent = 0;

    for (const branch of activeBranches) {
      const recipients = recipientsByCompany[branch.companyId] ?? [];
      if (recipients.length === 0) continue;

      const sent = await step.run(`check-kpi-${branch.id}`, async () => {
        const endDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        const startDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

        const [kpis, targets] = await Promise.all([
          calculateFinancialKPIs({
            companyId: branch.companyId,
            branchId: branch.id,
            startDate,
            endDate,
          }),
          getFinancialTargets(branch.companyId),
        ]);

        interface PendingAlert {
          text: string;
          critical: boolean;
        }
        const alerts: PendingAlert[] = [];

        /** Sufijo que nombra la tendencia solo cuando hay período anterior comparable. */
        const trend = (deltaPoints: number | null): string => {
          if (deltaPoints === null || Math.abs(deltaPoints) < 0.1) return "";
          const dir = deltaPoints > 0 ? "subió" : "bajó";
          return ` (${dir} ${Math.abs(deltaPoints).toFixed(1)} pts vs. la semana anterior)`;
        };

        if (kpis.foodCost.status === "CRITICAL" || kpis.foodCost.status === "WARNING") {
          const critical = kpis.foodCost.status === "CRITICAL";
          alerts.push({
            critical,
            text:
              `${critical ? "🚨" : "⚠️"} Food Cost de ${branch.name}: ` +
              `${kpis.foodCost.percent}% contra un objetivo de ${targets.foodCostTargetPercent}%` +
              `${trend(kpis.foodCost.deltaPoints)}. Revisa merma y recepción de mercancía.`,
          });
        }

        if (kpis.laborCost.status === "CRITICAL" || kpis.laborCost.status === "WARNING") {
          const critical = kpis.laborCost.status === "CRITICAL";
          alerts.push({
            critical,
            text:
              `${critical ? "🚨" : "⚠️"} Labor Cost de ${branch.name}: ` +
              `${kpis.laborCost.percent}% contra un objetivo de ${targets.laborCostTargetPercent}%` +
              `${trend(kpis.laborCost.deltaPoints)}. Revisa horas extra y plan de turnos.`,
          });
        }

        if (alerts.length === 0) return 0;

        // Si el número que dispara la alerta no se midió, se dice en el propio
        // mensaje. Una desviación calculada sobre compras puede ser un artefacto
        // del método, y quien la recibe necesita saberlo antes de actuar.
        const caveat =
          kpis.weakestSource === "MEASURED"
            ? ""
            : "\n\nNota: este cálculo es aproximado — algún insumo no se midió directamente.";

        let delivered = 0;
        for (const alert of alerts) {
          for (const userId of recipients) {
            try {
              await NotificationDispatcher.sendNotification({
                userId,
                title: alert.critical
                  ? "🚨 Alerta Crítica de Rentabilidad"
                  : "⚠️ Advertencia de Costos Operativos",
                message: alert.text + caveat,
                type: alert.critical ? "warning" : "info",
                eventType: "financial_kpi_deviation",
                actionUrl: `/dashboard/finance?branchId=${branch.id}`,
                actionLabel: "Ver Finanzas",
                metadata: {
                  branchName: branch.name,
                  branchId: branch.id,
                  foodCostPercent: kpis.foodCost.percent,
                  foodCostStatus: kpis.foodCost.status,
                  laborCostPercent: kpis.laborCost.percent,
                  laborCostStatus: kpis.laborCost.status,
                  healthyMarginPercent: kpis.healthyMarginPercent,
                  source: kpis.weakestSource,
                },
              });
              delivered++;
            } catch (err) {
              console.warn(
                `[checkFinancialAlerts] Falló el envío para ${branch.name} → ${userId}:`,
                err,
              );
            }
          }
        }
        return delivered;
      });

      alertsSent += sent;
    }

    return { checked: activeBranches.length, alertsSent };
  },
);
