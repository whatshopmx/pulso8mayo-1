import { inngest } from "@/lib/inngest/client";
import { NotificationRouter } from "@/lib/notifications/notification-router";
import { NotificationPayload } from "@/lib/services/notification-dispatcher";

/**
 * Durable notification dispatch.
 *
 * Replaces the hybrid QStash + in-memory `NotificationQueue` processor. The
 * producer (e.g. `app/api/notifications/dispatch` → `NotificationQueue.enqueue`)
 * emits a `notification/dispatch.requested` event with an idempotent event id
 * derived deterministically from the payload. This function owns every side
 * effect (preference filtering, template resolution, WhatsApp/Email/In-app
 * delivery) inside a single `step.run` boundary so work survives crashes and
 * retries.
 *
 * Idempotency: deterministic event-id dedupe in Inngest (24h window) + `step.run`
 * memoization — completed steps are cached, so retries never re-run an
 * already-dispatched notification. The routing/dispatcher layer
 * (`NotificationRouter` → `NotificationDispatcher`) already isolates per-channel
 * failures internally (`Promise.allSettled` + per-channel try/catch), so there
 * is no benefit to splitting deliveries into separate steps.
 */

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

    if (!payload || !payload.userId || !payload.eventType) {
      return { success: false, error: "Invalid notification payload" };
    }

    await step.run("dispatch-notification", async () => {
      await NotificationRouter.sendWithRouting(payload);
    });

    return { success: true, notificationId: id };
  }
);