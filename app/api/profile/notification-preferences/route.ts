import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationPreferences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
    fromStoredPreferences,
    hasPreferenceInput,
    normalizePreferenceInput,
    toStoredPreferencesPatch,
} from "@/lib/notifications/preferences-contract";

/**
 * Ruta compatible de preferencias de notificación.
 *
 * C32: comparte el contrato canónico con `/api/notifications/preferences` y
 * `/api/users/profile/preferences`. Antes devolvía `stockAlerts`/`shiftReminders`
 * inventados en `true`; ahora lee y escribe las columnas reales. Se conserva el
 * sobre `{ data }` por compatibilidad con consumidores existentes.
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

        const prefs = await db.query.notificationPreferences.findFirst({
            where: eq(notificationPreferences.userId, session.user.id)
        });

        return NextResponse.json({ data: fromStoredPreferences(prefs) });
    } catch (error) {
        console.error("Error fetching notification preferences:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}

export async function PUT(req: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const patch = normalizePreferenceInput(body);

        if (!hasPreferenceInput(patch)) {
            return NextResponse.json(
                { error: "No hay preferencias válidas que guardar" },
                { status: 400 }
            );
        }

        const userId = session.user.id;
        const existing = await db.query.notificationPreferences.findFirst({
            where: eq(notificationPreferences.userId, userId)
        });

        const merged = { ...fromStoredPreferences(existing), ...patch };
        const stored = toStoredPreferencesPatch(merged);

        await db
            .insert(notificationPreferences)
            .values({ userId, ...stored })
            .onConflictDoUpdate({
                target: notificationPreferences.userId,
                set: { ...stored, updatedAt: new Date() },
            });

        return NextResponse.json({ data: fromStoredPreferences(stored) });
    } catch (error) {
        console.error("Error updating notification preferences:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}
