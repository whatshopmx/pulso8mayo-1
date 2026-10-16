import { inngest } from "@/lib/inngest/client";
import {
  NotificationDispatcher,
  NotificationPayload,
  NotificationTemplate,
  UserData,
  ChannelDeliveryResult,
} from "@/lib/services/notification-dispatcher";
import type { NotificationChannel } from "@/lib/notifications/routing-policy";

/**
 * C34.2 — entrega durable por canal.
 *
 * Antes, todo el despacho vivía en un solo `step.run`: un fallo transitorio de
 * un canal hacía reintentar la función entera y volvía a enviar los canales que
 * ya habían salido. Ahora el plan es un paso y **cada canal es su propio paso**.
 * Inngest memoiza los pasos completados, así que un reintento re-ejecuta sólo el
 * canal que falló.
 *
 * Un canal con fallo **transitorio lanza** dentro de su paso para no memoizarse;
 * `skipped` y los fallos terminales completan el paso y quedan registrados sin
 * reintento. Registrar texto no cuenta como envío: sólo `sent` es enviado.
 *
 * La lógica vive en `runNotificationDispatch`, con un `step` mínimo, para poder
 * probarla sin levantar el runtime de Inngest.
 */

/** Lo único que la lógica necesita de `step`: memoizar por id. */
export interface DurableStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

export interface DispatchOutcome {
  success: boolean;
  notificationId?: string;
  reason?: string;
  results?: ChannelDeliveryResult[];
}

interface PlannedDelivery {
  shouldSend: boolean;
  reason?: string;
  channels: NotificationChannel[];
  template: NotificationTemplate;
  userData: UserData | null;
}

export async function runNotificationDispatch(
  payload: NotificationPayload,
  step: DurableStep,
  notificationId?: string
): Promise<DispatchOutcome> {
  if (!payload?.userId || !payload?.eventType) {
    return { success: false, reason: "Invalid notification payload" };
  }

  // El plan se decide una sola vez y se memoiza: en un reintento no se vuelven
  // a leer preferencias, usuario ni zona.
  const plan = await step.run("plan-delivery", async () => {
    const prepared = await NotificationDispatcher.planDelivery(payload);
    if (!prepared) return null;
    return {
      shouldSend: prepared.decision.shouldSend,
      reason: prepared.decision.reason,
      channels: prepared.decision.channels,
      template: prepared.template,
      userData: prepared.userData,
    } satisfies PlannedDelivery;
  });

  if (!plan || !plan.shouldSend) {
    return {
      success: true,
      notificationId,
      reason: plan?.reason ?? "sin plan de entrega",
      results: [],
    };
  }

  // Se esperan **todos** los canales (no `Promise.all`): así los que sí salieron
  // terminan y quedan memoizados antes de lanzar el reintento.
  const settled = await Promise.allSettled(
    plan.channels.map((channel) =>
      step.run(`deliver-${channel}`, async () => {
        const result = await NotificationDispatcher.deliverChannel(
          channel,
          payload,
          plan.template,
          plan.userData
        );

        // Un fallo transitorio no se memoiza: el reintento debe volver a
        // intentar este canal. Los canales ya completados sí quedan cacheados.
        if (result.status === "failed" && result.kind === "transient") {
          throw new Error(`Canal ${channel} falló de forma transitoria: ${result.reason ?? "sin motivo"}`);
        }

        return result;
      })
    )
  );

  const results: ChannelDeliveryResult[] = [];
  const transient: string[] = [];

  settled.forEach((entry, index) => {
    if (entry.status === "fulfilled") {
      results.push(entry.value);
    } else {
      transient.push(plan.channels[index]);
    }
  });

  if (transient.length > 0) {
    throw new Error(`Canales con fallo transitorio: ${transient.join(", ")}`);
  }

  return { success: true, notificationId, results };
}

export const notificationDispatchFn = inngest.createFunction(
  {
    id: "notification-dispatch",
    triggers: [{ event: "notification/dispatch.requested" }],
    retries: 3,
    concurrency: 10,
  },
  async ({ event, step }) => {
    const { id, payload } = event.data as {
      id: string;
      payload: NotificationPayload;
    };

    const outcome = await runNotificationDispatch(
      payload,
      step as unknown as DurableStep,
      id
    );

    return outcome;
  }
);
