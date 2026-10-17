import { NextRequest, NextResponse } from "next/server";
import { NotificationQueue } from "@/lib/notifications/notification-queue";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { isApiError } from "@/lib/api/error";

/**
 * POST /api/notifications/dispatch
 * Encola una notificación para entrega asíncrona.
 *
 * S-2 (Phase -1 / security gate): antes no exigía autenticación, así que
 * cualquiera podía encolar una notificación arbitraria para cualquier `userId`
 * (vector de spam/phishing por WhatsApp o email). Ahora exige rol con
 * `settings:manage` (ADMIN/OWNER/SUPER_ADMIN; GERENTE no alcanza) y la decisión
 * queda auditada en `data_access_logs`.
 */
export async function POST(req: NextRequest) {
  try {
    await requirePermissionApi("settings", "manage", {
      audit: { action: "UPDATE", req },
    });

    const body = await req.json();
    const { userId, title, message, type, eventType, actionUrl, actionLabel, metadata } = body;

    if (!userId || !title || !message || !eventType) {
      return NextResponse.json(
        { error: "userId, title, message, and eventType are required" },
        { status: 400 }
      );
    }

    const payload = {
      userId,
      title,
      message,
      type: type || "info",
      eventType,
      actionUrl,
      actionLabel,
      metadata: metadata || {},
    };

    const notificationId = await NotificationQueue.enqueue(payload);

    return NextResponse.json({
      success: true,
      notificationId,
      message: "Notification queued for delivery",
    });
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error dispatching notification:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/notifications/dispatch
 * Estado de la cola. La cola la procesa Inngest (sin estado local).
 * Protegido con el mismo guard que POST.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermissionApi("settings", "read", {
      audit: { action: "READ", req },
    });

    const status = await NotificationQueue.getStatus();
    return NextResponse.json({
      status,
      note: "Queue is now processed by Inngest; no local queue state.",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error getting dispatch status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
