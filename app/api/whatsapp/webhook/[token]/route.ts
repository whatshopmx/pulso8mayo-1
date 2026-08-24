import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
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
 *
 * Auth: WHAPI no firma sus webhooks (no existe un parámetro `secret` en
 * updateChannelSettings), así que el secreto vive en la URL:
 * `/api/whatsapp/webhook/<WHAPI_WEBHOOK_TOKEN>`. La comparación es
 * timing-safe y un mismatch responde 404 para no revelar que la ruta existe.
 */

function isAuthorized(token: string): boolean {
  const expected = process.env.WHAPI_WEBHOOK_TOKEN;
  if (!expected || expected.length < 16 || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!isAuthorized(token)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

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

export async function GET() {
  return NextResponse.json({
    status: 'alive',
    service: 'whatsapp-webhook',
    supports: ['whapi'],
  });
}
