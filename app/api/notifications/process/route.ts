import { NextRequest, NextResponse } from "next/server";
import { NotificationRouter } from "@/lib/notifications/notification-router";
import type { NotificationEventType } from "@/lib/notifications/routing-policy";
import { verifyQstashSignature } from "@/lib/api/internal-auth";

type NotificationType = "error" | "success" | "info" | "warning";

/**
 * POST /api/notifications/process
 *
 * DEPRECATED — la cola de notificaciones vive en Inngest
 * (`notification/dispatch.requested` + `lib/inngest/functions/notification-dispatch.ts`).
 * Este endpoint se conserva como shim síncrono para cualquier cola QStash
 * heredada que todavía apunte aquí; se retirará cuando no quede llamador externo.
 *
 * S-2 (Phase -1 / security gate): antes no verificaba nada, así que cualquiera
 * podía enviar notificaciones arbitrarias a cualquier `userId`. Ahora exige la
 * firma HMAC de QStash (`verifyQstashSignature`, falla cerrado). El cuerpo se
 * lee como texto crudo porque la firma se calcula sobre los bytes exactos.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    if (!(await verifyQstashSignature(req, rawBody))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as {
      userId?: string;
      title?: string;
      message?: string;
      type?: string;
      eventType?: string;
      actionUrl?: string;
      actionLabel?: string;
      metadata?: Record<string, unknown>;
    };
    const {
      userId,
      title,
      message,
      type,
      eventType,
      actionUrl,
      actionLabel,
      metadata,
    } = body;

    if (!userId || !eventType) {
      return NextResponse.json(
        { error: "userId and eventType are required" },
        { status: 400 }
      );
    }

    await NotificationRouter.sendWithRouting({
      userId,
      title: title || "",
      message: message || "",
      type: (type as NotificationType) || "info",
      eventType: eventType as NotificationEventType,
      actionUrl,
      actionLabel,
      metadata: metadata || {},
    });

    return NextResponse.json({
      success: true,
      message: "Notification processed successfully",
    });
  } catch (error) {
    console.error("Error processing notification:", error);
    return NextResponse.json(
      {
        error: "Processing failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
