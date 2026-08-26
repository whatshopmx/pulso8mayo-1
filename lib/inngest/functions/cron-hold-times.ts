import { inngest } from "@/lib/inngest/client";
import { HoldTimeService } from "@/lib/services/hold-time-service";

/**
 * Task 5 (plan-loteprod-gaps §6.4) — vigilancia del tiempo de retención en
 * línea. Detecta tandas de `production_results` cuyo `expires_at` (Task 4) ya
 * pasó y siguen sin cerrarse: avisa al turno una sola vez por tanda y, pasada
 * la gracia, registra la merma HOLD_TIME por su cuenta.
 *
 * Cadencia cada 15 min, no horaria: los hold times del manual van de 7 a 30
 * minutos (papas 7, hamburguesa armada 10). Con un cron horario el aviso podía
 * llegar 59 minutos tarde — el producto ya se habría servido o tirado sin
 * registro, que es justo lo que §6.4 quiere evitar. El barrido es barato: el
 * índice parcial `production_results_hold_pending_idx` sólo cubre tandas con
 * hold time y sin cerrar.
 *
 * Idempotente: correrlo dos veces seguidas no re-notifica (claim atómico sobre
 * `hold_alert_notified_at`) ni duplica mermas (único parcial sobre
 * `inventory_waste.production_result_id`).
 */
export const cronHoldTimes = inngest.createFunction(
  {
    id: "cron-hold-times",
    triggers: [{ cron: "*/15 * * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    const holdTimes = await step.run("process-hold-time-expirations", async () => {
      return await HoldTimeService.processHoldTimeExpirations();
    });

    return { success: true, holdTimes };
  }
);
