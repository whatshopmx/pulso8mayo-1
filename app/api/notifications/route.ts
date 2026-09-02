import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { eq, desc, and, count } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { NotificationQueue } from "@/lib/notifications/notification-queue";

/**
 * GET /api/notifications
 * Get user notifications
 */
export async function GET(req: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(req.url);
        const limit = parseInt(searchParams.get("limit") || "50");
        const unreadOnly = searchParams.get("unreadOnly") === "true";

        const whereConditions = [eq(notifications.userId, session.user.id)];
        if (unreadOnly) {
            whereConditions.push(eq(notifications.read, false));
        }

        const userNotifications = await db.query.notifications.findMany({
            where: and(...whereConditions),
            orderBy: [desc(notifications.createdAt)],
            limit
        });

        /**
         * El contador no puede salir de la página que se acaba de traer.
         *
         * Contar los no leídos dentro de `userNotifications` los cuenta sobre
         * el `limit` (20 desde el bell), así que a partir de la nota 21 el
         * badge se queda clavado en 20 aunque haya 300 pendientes. El conteo
         * es una consulta aparte, sin `limit`.
         */
        const [{ value: unreadCount }] = await db
            .select({ value: count() })
            .from(notifications)
            .where(and(
                eq(notifications.userId, session.user.id),
                eq(notifications.read, false)
            ));

        return NextResponse.json({
            data: userNotifications,
            unreadCount
        });
    } catch (error) {
        console.error("Error fetching notifications:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/notifications
 * Mark notification as read
 */
export async function PATCH(req: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const { notificationId, markAllAsRead } = body;

        if (markAllAsRead) {
            // Mark all as read
            await db.update(notifications)
                .set({ read: true, readAt: new Date() })
                .where(eq(notifications.userId, session.user.id));

            return NextResponse.json({
                success: true,
                message: "Todas las notificaciones marcadas como leídas"
            });
        }

        if (!notificationId) {
            return NextResponse.json(
                { error: "notificationId es requerido" },
                { status: 400 }
            );
        }

        // Marcar una nota concreta. El `userId` va en el WHERE, no sólo el id:
        // sin él cualquier sesión podía marcar leída la notificación de otro
        // usuario —de otro tenant incluso— con sólo adivinar el uuid.
        await db.update(notifications)
            .set({ read: true, readAt: new Date() })
            .where(and(
                eq(notifications.id, notificationId),
                eq(notifications.userId, session.user.id)
            ));

        return NextResponse.json({
            success: true,
            message: "Notificación marcada como leída"
        });
    } catch (error) {
        console.error("Error updating notification:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}
