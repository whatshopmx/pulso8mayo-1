import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { notificationPreferences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
    fromStoredPreferences,
    hasPreferenceInput,
    normalizePreferenceInput,
    toStoredPreferencesPatch,
} from "@/lib/notifications/preferences-contract";

/**
 * PATCH /api/notifications/preferences
 * Guarda las preferencias del usuario en sesión.
 *
 * C32: el cuerpo se normaliza con el contrato canónico. Un campo omitido
 * conserva lo que estaba guardado —antes se reseteaba a `true`— y un cuerpo sin
 * ninguna preferencia válida se rechaza en vez de escribir defaults silenciosos.
 */
export async function PATCH(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const patch = normalizePreferenceInput(body);

        if (!hasPreferenceInput(patch)) {
            return NextResponse.json(
                { error: "No hay preferencias válidas que guardar" },
                { status: 400 }
            );
        }

        const existing = await db.query.notificationPreferences.findFirst({
            where: eq(notificationPreferences.userId, session.user.id),
        });

        // Se escribe el estado completo: lo guardado + lo que llegó.
        const merged = { ...fromStoredPreferences(existing), ...patch };
        const stored = toStoredPreferencesPatch(merged);

        await db
            .insert(notificationPreferences)
            .values({ userId: session.user.id, ...stored })
            .onConflictDoUpdate({
                target: notificationPreferences.userId,
                set: { ...stored, updatedAt: new Date() },
            });

        return NextResponse.json(fromStoredPreferences(stored));

    } catch (error) {
        console.error("[Preferences API] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

/**
 * GET /api/notifications/preferences
 * Devuelve las preferencias del usuario en sesión con el contrato canónico.
 */
export async function GET() {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const prefs = await db.query.notificationPreferences.findFirst({
            where: eq(notificationPreferences.userId, session.user.id),
        });

        // Sin fila se devuelven los defaults del contrato, nunca una forma distinta.
        return NextResponse.json(fromStoredPreferences(prefs));

    } catch (error) {
        console.error("[Preferences API] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
