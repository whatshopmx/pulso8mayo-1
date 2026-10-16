import { NotificationDispatcher, NotificationPayload } from "@/lib/services/notification-dispatcher";
import {
  NotificationChannel,
  NotificationEventType,
  RoutingDecision,
  RoutingRule,
  getRoutingRule,
  getRoutingRules,
  updateRoutingRule,
} from "@/lib/notifications/routing-policy";

/**
 * C33 — el router y el dispatcher comparten una sola decisión.
 *
 * Antes, `route()` calculaba los canales, los metía en `metadata.routedChannels`
 * y el dispatcher los ignoraba: volvía a elegir por plantilla y preferencias, y
 * el horario se medía con la zona del proceso. Ahora `route()` delega en
 * `NotificationDispatcher.decideChannels`, que usa la política pura
 * (`routing-policy.ts`). `sendWithRouting` sólo envía: el dispatcher decide y
 * entrega exactamente lo decidido.
 */

export type { NotificationChannel, NotificationEventType, RoutingDecision, RoutingRule };
export { getRoutingRule, getRoutingRules, updateRoutingRule };

export class NotificationRouter {
  /**
   * Decisión de enrutamiento para un payload: canales, prioridad y reintentos.
   * Es la misma que aplica el dispatcher al enviar.
   */
  static async route(payload: NotificationPayload): Promise<RoutingDecision> {
    return NotificationDispatcher.decideChannels(payload);
  }

  /**
   * Envía con la decisión del dispatcher. No se vuelve a decidir aquí: si lo
   * hiciera, volvería a existir la divergencia que H09 describe.
   */
  static async sendWithRouting(payload: NotificationPayload): Promise<void> {
    await NotificationDispatcher.sendNotification(payload);
  }

  /**
   * Envía un lote ordenado por prioridad. La prioridad sale de la regla, que
   * es la misma que usa la decisión de canales.
   */
  static async sendBatchWithRouting(payloads: NotificationPayload[]): Promise<void> {
    const grouped = this.groupByPriority(payloads);

    for (const priority of ["critical", "high", "normal", "low"] as const) {
      const batch = grouped[priority];
      if (batch) {
        await Promise.all(batch.map((payload) => this.sendWithRouting(payload)));
      }
    }
  }

  private static groupByPriority(payloads: NotificationPayload[]): {
    critical?: NotificationPayload[];
    high?: NotificationPayload[];
    normal?: NotificationPayload[];
    low?: NotificationPayload[];
  } {
    const grouped: Record<string, NotificationPayload[]> = {};

    payloads.forEach((payload) => {
      const rule = getRoutingRule(payload.eventType);
      if (!rule) return;
      (grouped[rule.priority] ??= []).push(payload);
    });

    return grouped;
  }
}
