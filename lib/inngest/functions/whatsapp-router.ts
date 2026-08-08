import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { whatsappMessages, users, notificationPreferences } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { messageRouter } from "@/lib/whatsapp/message-router";
import { sessionManager } from "@/lib/whatsapp/session-manager";
import { whatsappClient } from "@/lib/whatsapp/client-factory";

/**
 * Durable WhatsApp message processing.
 *
 * The webhook (`app/api/whatsapp/webhook/route.ts`) acknowledges fast and emits
 * a `whatsapp/message.received` event with an idempotent event id
 * (`id = message.id`, 24h dedupe window). This function owns every side effect
 * (DB writes, opt-in/out preferences, WhatsApp replies, AI/evidence routing)
 * inside `step.run` boundaries so work survives crashes and retries.
 *
 * Idempotency: event-id dedupe in Inngest + a DB guard on `externalMessageId`
 * before any side effect runs.
 */

interface WhapiMessage {
  id: string;
  from_me: boolean;
  type: string;
  chat_id: string;
  timestamp: number;
  source?: string;
  text?: { body: string };
  caption?: string;
  from?: string;
  from_name?: string;
  media?: string;
  location?: { latitude: number; longitude: number };
}

interface NormalizedPayload {
  event: string;
  sessionId: string;
  from: string;
  to?: string;
  message: string;
  type: string;
  messageId: string;
  timestamp: Date;
  fromMe: boolean;
  mediaUrl?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

function normalizePayload(msg: WhapiMessage): NormalizedPayload {
  const from = (msg.from || msg.chat_id || '').replace(/@.*$/, '');

  return {
    event: 'message',
    sessionId: 'default',
    from,
    to: undefined,
    message: msg.text?.body || msg.caption || '',
    type: msg.type === 'text' ? 'text' : msg.type,
    messageId: msg.id,
    timestamp: new Date(msg.timestamp * 1000),
    fromMe: msg.from_me,
    mediaUrl: msg.media,
    location: msg.location
      ? {
          latitude: msg.location.latitude,
          longitude: msg.location.longitude,
        }
      : undefined,
  };
}

const OPT_OUT_COMMANDS = ['stop', 'alto', 'parar', 'no notificar', 'opt-out', 'unsubscribe'];
const OPT_IN_COMMANDS = ['start', 'inicio', 'comenzar', 'activar', 'opt-in', 'subscribe'];

export const processWhatsAppMessageFn = inngest.createFunction(
  {
    id: "whatsapp-route-message",
    triggers: [{ event: "whatsapp/message.received" }],
    retries: 3,
    concurrency: 5,
  },
  async ({ event, step }) => {
    const { message } = event.data as { message: WhapiMessage };
    const normalized = normalizePayload(message);

    // Outbound messages are mirrored by WHAPI but never processed.
    if (normalized.fromMe) {
      return { skipped: true, reason: 'outbound' };
    }

    // Idempotency guard: if this inbound message was already recorded, treat
    // the redelivery as a no-op. Works even if Inngest event dedupe is missed.
    const existing = await step.run("check-already-processed", async () => {
      const rows = await db
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.externalMessageId, normalized.messageId))
        .limit(1);
      return rows[0] ?? null;
    });

    if (existing) {
      return { skipped: true, reason: 'already-processed' };
    }

    await step.run("insert-message", async () => {
      await db.insert(whatsappMessages).values({
        sessionId: normalized.sessionId,
        direction: 'INBOUND',
        from: normalized.from,
        to: normalized.to || '',
        messageType: normalized.type,
        content: normalized.message,
        mediaUrl: normalized.mediaUrl,
        externalMessageId: normalized.messageId,
        processed: false,
      });
    });

    if (normalized.type === 'text') {
      const messageText = normalized.message.toLowerCase().trim();
      const isOptOut = OPT_OUT_COMMANDS.some((cmd) => messageText.includes(cmd));
      const isOptIn = OPT_IN_COMMANDS.some((cmd) => messageText.includes(cmd));

      if (isOptOut || isOptIn) {
        const session = await step.run("get-session", async () => {
          return sessionManager.getSession(normalized.sessionId);
        });

        let handled = false;
        if (session) {
          const user = await step.run("find-user", async () => {
            return db.query.users.findFirst({
              where: and(
                eq(users.phone, normalized.from),
                eq(users.companyId, session.companyId)
              ),
            });
          });

          if (user) {
            await step.run("set-preference", async () => {
              await db
                .insert(notificationPreferences)
                .values({
                  userId: user.id,
                  whatsappEnabled: isOptIn,
                })
                .onConflictDoUpdate({
                  target: notificationPreferences.userId,
                  set: {
                    whatsappEnabled: isOptIn,
                    updatedAt: new Date(),
                  },
                });
            });

            const confirmationMessage = isOptIn
              ? `✅ *Notificaciones Activadas*\n\nHas activado las notificaciones de WhatsApp.\n\nEscribe *ayuda* para ver los comandos disponibles.`
              : `🛑 *Notificaciones Desactivadas*\n\nHas desactivado las notificaciones de WhatsApp.\n\nPara reactivarlas, escribe *inicio*.`;

            await step.run("send-confirmation", async () => {
              await whatsappClient.sendMessage({
                sessionId: normalized.sessionId,
                to: normalized.from,
                message: confirmationMessage,
              });
            });
            handled = true;
          }
        }

        await step.run("mark-processed", async () => {
          await db
            .update(whatsappMessages)
            .set({ processed: true })
            .where(eq(whatsappMessages.externalMessageId, normalized.messageId));
        });

        return { handled, type: isOptOut ? 'opt-out' : 'opt-in' };
      }
    }

    const result = await step.run("route-message", async () => {
      return messageRouter.routeMessage({
        sessionId: normalized.sessionId,
        from: normalized.from,
        message: normalized.message,
        messageType: normalized.type as
          | 'text'
          | 'image'
          | 'document'
          | 'audio'
          | 'video'
          | 'location',
        mediaUrl: normalized.mediaUrl,
        timestamp: normalized.timestamp,
        location: normalized.location,
      });
    });

    if (!result.success) {
      console.error('[WhatsApp] Message routing failed:', result.error);
      await step.run("record-error", async () => {
        await sessionManager.recordError(normalized.sessionId, result.error || 'Unknown error');
      });
    }

    await step.run("mark-processed", async () => {
      await db
        .update(whatsappMessages)
        .set({ processed: true })
        .where(eq(whatsappMessages.externalMessageId, normalized.messageId));
    });

    return { success: result.success };
  }
);
