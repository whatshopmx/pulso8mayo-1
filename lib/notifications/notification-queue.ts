import { inngest } from "@/lib/inngest/client";
import { notificationDispatchRequested } from "@/lib/inngest/events";
import { NotificationPayload } from "@/lib/services/notification-dispatcher";

/**
 * NotificationQueue — now a thin durable facade over Inngest.
 *
 * The previous implementation used a hybrid QStash + in-memory queue with a
 * `setInterval` background processor. The in-memory fallback lost all pending
 * work on deploy/restart, and queue ids were non-deterministic
 * (`notif_${Date.now()}_${random}`), so double-submit/retry could duplicate
 * WhatsApp/Email/In-app notifications.
 *
 * Now `enqueue` simply emits a durable `notification/dispatch.requested` event
 * with a deterministic id derived from the payload. The durable function in
 * `lib/inngest/functions/notification-dispatch.ts` owns all side effects inside
 * `step.run`, so work outlives crashes and retries never re-run a completed
 * dispatch (event-id dedupe + step memoization).
 *
 * The return id stays compatible with the previous interface so callers don't
 * need to know about the underlying event.
 */

/** FNV-1a-ish stable string hash — deterministic across restarts (pure JS). */
function stableHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Build a deterministic notification id. A caller-supplied `dedupeKey` in
 * `payload.metadata` wins (explicit dedupe control for producers); otherwise
 * the id is derived from a canonical hash of the payload so a retried dispatch
 * of the same logical notification produces the same event id (deduped within
 * the Inngest 24h window).
 */
export function notificationIdFor(payload: NotificationPayload): string {
  const dedupeKey = payload.metadata?.dedupeKey;
  if (typeof dedupeKey === "string" && dedupeKey.length > 0) {
    return `notif_${dedupeKey}`;
  }
  const canonical = JSON.stringify({
    userId: payload.userId,
    eventType: payload.eventType,
    title: payload.title,
    message: payload.message,
    metadata: payload.metadata,
  });
  return `notif_${stableHash(canonical)}`;
}

export interface NotificationQueuePayload extends NotificationPayload {
  id: string;
  createdAt: number;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: number;
}

export interface QueueStatus {
  queued: number;
  processing: number;
  failed: number;
  completed: number;
}

export class NotificationQueue {
  /**
   * Enqueue a notification for async processing (durable). Returns the
   * deterministic notification id used as the Inngest event id.
   *
   * Throws if the event cannot be sent so the caller can surface a failure and
   * retry (at-least-once). There is intentionally no in-memory fallback: any
   * non-durable buffer would just lose work on restart again.
   */
  static async enqueue(payload: NotificationPayload): Promise<string> {
    const id = notificationIdFor(payload);

    await inngest.send({
      name: notificationDispatchRequested.name,
      id: `notification-dispatch:${id}`,
      data: { id, payload },
    });

    console.log(`[NotificationQueue] Dispatched ${id} to Inngest`);
    return id;
  }

  /**
   * Enqueue multiple notifications.
   */
  static async enqueueBatch(payloads: NotificationPayload[]): Promise<string[]> {
    const ids = await Promise.all(
      payloads.map((payload) => this.enqueue(payload))
    );
    return ids;
  }

  /**
   * Compatibility status accessor. The queue is handled entirely by Inngest now,
   * so there is no local in-memory state to report.
   */
  static async getStatus(): Promise<QueueStatus> {
    return { queued: 0, processing: 0, failed: 0, completed: 0 };
  }
}