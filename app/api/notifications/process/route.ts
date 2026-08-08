import { NextRequest, NextResponse } from "next/server";
import { NotificationRouter } from "@/lib/notifications/notification-router";

/**
 * POST /api/notifications/process
 *
 * DEPRECATED — the notification queue moved to Inngest
 * (`notification/dispatch.requested` + `lib/inngest/functions/notification-dispatch.ts`).
 * This endpoint was previously called by QStash; it is kept as a synchronous
 * compat shim so any legacy QStash queue (or manual caller) targeting it still
 * delivers. Remove once no external caller remains.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
      type: type || "info",
      eventType,
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