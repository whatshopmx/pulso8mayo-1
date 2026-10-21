// Task 8 (plan tasks/plan-aguinaldo.md): recordatorio de dispersión de
// aguinaldo — diciembre, días 1 a 19, 08:00.
//
// El Art. 87 LFT obliga a pagar el aguinaldo antes del 19 de diciembre;
// incumplir es multa de 50 a 5,000 UMA (Art. 1002). Este cron alerta a los
// admins cuando el año todavía NO tiene run de aguinaldo COMPLETED.
//
// Dedupe (companyId + año): una sola notificación por año por empresa —
// si ya se avisó (o ya se dispersó), silencio. [AC: no duplica
// notificaciones el mismo día, no duplica en todo diciembre].

import { inngest } from "../client";
import { db } from "@/lib/db";
import { notifications, payrollRuns, users } from "@/lib/db/schema";
import { and, eq, gte, inArray, ilike, or } from "drizzle-orm";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

const RECIPIENT_ROLES = ["OWNER", "ADMIN"] as const;
const LIMITE = "19 de diciembre";

export const cronAguinaldoReminder = inngest.createFunction(
  {
    id: "cron-aguinaldo-reminder",
    triggers: [{ cron: "0 8 1-19 12 *" }], // 1 al 19 de diciembre, 08:00
    retries: 2,
  },
  async ({ step }) => {
    const hoy = new Date();
    const anio = String(hoy.getFullYear()); // el aguinaldo del año vence el 19-dic del mismo año

    // 1. Empresas con dispersión PENDIENTE: sin run COMPLETED del año.
    const pendientes = await step.run("empresas-sin-run-aguinaldo", async () => {
      const companies = await db
        .select({ companyId: users.companyId })
        .from(users)
        .where(and(inArray(users.role, [...RECIPIENT_ROLES]), eq(users.active, true)))
        .groupBy(users.companyId);

      const ids = companies.map((c) => c.companyId).filter((id): id is string => id != null);
      if (ids.length === 0) return [];

      // Una corrida con errores NO cuenta como dispersa (falta timbrar a los
      // que fallaron); el run se re-ejecuta cuando venga.
      const runsHechos = await db
        .select({ companyId: payrollRuns.companyId })
        .from(payrollRuns)
        .where(
          and(
            inArray(payrollRuns.companyId, ids),
            eq(payrollRuns.aguinaldoFiscalYear, Number(anio)),
            eq(payrollRuns.status, "COMPLETED"),
          ),
        );

      const yaDispersos = new Set(runsHechos.map((r) => r.companyId));
      return ids.filter((id) => !yaDispersos.has(id));
    });

    if (pendientes.length === 0) return { anio, pendientes: 0, notificadas: 0 };

    // 2. Destinatarios por empresa.
    const recipPorEmpresa = await step.run("destinatarios", async () => {
      const rows = await db
        .select({ id: users.id, companyId: users.companyId })
        .from(users)
        .where(
          and(
            inArray(users.companyId, pendientes),
            inArray(users.role, [...RECIPIENT_ROLES]),
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

    // 3. Envío con dedupe (companyId + año): la notificación in-app que envió
    //    el recordatorio lleva el año en el título; el run del día 1 basta
    //    para todo el diciembre.
    const desdeDiciembre = new Date(`${anio}-12-01T00:00:00Z`);

    let notificadas = 0;
    for (const companyId of pendientes) {
      const recipients = recipPorEmpresa[companyId] ?? [];
      if (recipients.length === 0) continue;

      notificadas += await step.run(`avisar-${companyId}`, async () => {
        const yaAvisados = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              inArray(notifications.userId, recipients),
              gte(notifications.createdAt, desdeDiciembre),
              or(ilike(notifications.title, `%aguinaldo ${anio}%`), ilike(notifications.title, `%dispersar el aguinaldo ${anio}%`)),
            ),
          )
          .limit(1);
        if (yaAvisados.length > 0) return 0;

        let delivered = 0;
        for (const userId of recipients) {
          try {
            await NotificationDispatcher.sendNotification({
              userId,
              title: `Recordatorio: dispersar el aguinaldo ${anio} antes del ${LIMITE}`,
              message:
                `El Art. 87 LFT obliga a pagar el aguinaldo antes del ${LIMITE} ` +
                `(multa de 50 a 5,000 UMA por incumplir, Art. 1002). La dispersión se timbra ` +
                `como nómina extraordinaria (CFDI 002) desde Personal → Payroll → Aguinaldo ` +
                `${anio}. Cálculo vigente: 15 días por año prorrateados (la iniciativa de ` +
                `30 días por antigüedad NO es ley).`,
              type: "warning",
              eventType: "aguinaldo_dispersion_reminder",
              actionUrl: "/dashboard/labor/payroll",
              actionLabel: "Ir a Payroll",
              metadata: {
                companyId,
                anioFiscal: anio,
                dedupe: `aguinaldo-${companyId}-${anio}`,
              },
            });
            delivered++;
          } catch (err) {
            console.warn(`[cronAguinaldoReminder] Falló el envío para empresa ${companyId} → ${userId}:`, err);
          }
        }
        return delivered;
      });
    }

    return { anio, pendientes: pendientes.length, notificadas };
  },
);
