import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const markRead = body.read !== false;

    const [updated] = await db
      .update(notifications)
      .set({
        read: markRead,
        readAt: markRead ? new Date() : null,
      })
      .where(
        and(eq(notifications.id, id), eq(notifications.userId, session.user.id)),
      )
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Notificación no encontrada" },
        { status: 404 },
      );
    }

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
