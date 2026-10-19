import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { runRecurringPayablesCycle } from "@/lib/services/recurring-payable-service";

/**
 * Payables recurrentes: generar estimaciones y sincronizar las que ya tienen
 * CFDI (A19/C15).
 *
 * Corre diariamente por la mañana — antes de los recordatorios de las 8:00 —
 * para que la bandeja de CxP del día ya traiga la obligación del período. El
 * ciclo es idempotente por diseño (índice único contract+periodKey + cerrojo
 * en el sync), así que un crash del step es un re-run normal, no un doble
 * libro.
 */
export const cronRecurringPayables = inngest.createFunction(
  {
    id: "cron-recurring-payables",
    triggers: [{ cron: "30 6 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    const allCompanies = await step.run("list-companies", async () => {
      return db.select({ id: companies.id }).from(companies);
    });

    let totalCreated = 0;
    let totalInvoiced = 0;
    let companiesProcessed = 0;

    for (const company of allCompanies) {
      // Un step por empresa: el fallo de una empresa no detiene a las demás,
      // y el re-run de esa sola es barato (todo el ciclo es idempotente).
      const result = await step.run(
        `recurring-payables:${company.id}`,
        () => runRecurringPayablesCycle({ companyId: company.id })
      );
      companiesProcessed++;
      totalCreated += result.created;
      totalInvoiced += result.invoiced;
    }

    return {
      companiesProcessed,
      estimatedPayablesCreated: totalCreated,
      payablesInvoiced: totalInvoiced,
    };
  }
);
