import { inngest } from "@/lib/inngest/client";
import { checkImssDeadlines } from "@/lib/cron/imss-deadline-alerts";

/**
 * T22 — Alertas IMSS: recuerda fechas límite SUA/modificaciones
 * a OWNER/ADMIN 7, 3 y 1 días antes del vencimiento.
 */
export const imssAlerts = inngest.createFunction(
  {
    id: "imss-alerts",
    triggers: [{ cron: "0 8 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("check-imss-deadlines", () => checkImssDeadlines());
  }
);
