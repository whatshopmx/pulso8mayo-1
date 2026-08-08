import { NextRequest, NextResponse } from 'next/server';
import { inngest } from '@/lib/inngest/client';
import { whatsappMessageReceived } from '@/lib/inngest/events';
import { db } from '@/lib/db';
import { whatsappMessages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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

interface WhapiWebhookPayload {
  messages?: WhapiMessage[];
  event?: { type: string; event: string };
  channel_id?: string;
  statuses?: Array<{
    id: string;
    status: string;
    chat_id: string;
    timestamp: number;
  }>;
}

/**
 * Webhook strategy (durable): acknowledge fast, don't block on heavy work.
 * - Each inbound message is emitted as a `whatsapp/message.received` event with
 *   an idempotent `id` = message id (24h dedupe window). The durable function
 *   in `lib/inngest/functions/whatsapp-router.ts` owns the side effects.
 * - Status updates are cheap single-row writes and stay synchronous.
 * - If event emission fails we return 500 so the provider retries delivery
 *   (at-least-once semantics handled by the event id + DB guard).
 */

function handleStatusUpdate(id: string, status: string): Promise<unknown> {
  const statusMap: Record<string, string> = {
    sent: 'sent',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
  };
  const mapped = statusMap[status] || 'unknown';
  return db
    .update(whatsappMessages)
    .set({ status: mapped })
    .where(eq(whatsappMessages.externalMessageId, id));
}

export async function POST(req: NextRequest) {
  try {
    const body: WhapiWebhookPayload = await req.json();

    console.log('[WhatsApp Webhook] Received WHAPI event:', body.event?.type);

    if (body.statuses) {
      for (const status of body.statuses) {
        await handleStatusUpdate(status.id, status.status);
      }
    }

    if (body.messages) {
      for (const message of body.messages) {
        // Idempotent emit: id = message.id (Inngest dedupes within 24h).
        await inngest.send({
          name: whatsappMessageReceived.name,
          id: message.id,
          data: { message },
        });
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[WhatsApp Webhook] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(_req: NextRequest) {
  return NextResponse.json({
    status: 'alive',
    service: 'whatsapp-webhook',
    supports: ['whapi'],
  });
}