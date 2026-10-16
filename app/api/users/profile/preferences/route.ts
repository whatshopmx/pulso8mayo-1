import { NextRequest } from "next/server";
import { ApiHandler } from "@/lib/api/response";
import { db } from "@/lib/db";
import { notificationPreferences, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";
import {
    fromStoredPreferences,
    hasPreferenceInput,
    normalizePreferenceInput,
    toStoredPreferencesPatch,
} from "@/lib/notifications/preferences-contract";

/**
 * Preferencias del propio usuario + su teléfono de WhatsApp.
 *
 * C32: las preferencias se leen y escriben con el contrato canónico, igual que
 * las otras dos entradas. `whatsappPhone` sigue siendo un campo del usuario, no
 * una preferencia, y por eso se valida aparte.
 */
const phoneSchema = z.object({
    whatsappPhone: z.string().nullable().optional(),
});

async function getSessionUserId(): Promise<string | null> {
    const session = await auth.api.getSession({ headers: await headers() });
    return session?.user?.id ?? null;
}

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) return ApiHandler.error(new Error("Unauthorized"), { status: 401 });

        // Get or create preferences
        let prefs = await db.query.notificationPreferences.findFirst({
            where: eq(notificationPreferences.userId, userId),
        });

        if (!prefs) {
            const [newPrefs] = await db.insert(notificationPreferences)
                .values({ userId })
                .returning();
            prefs = newPrefs;
        }

        // Get current whatsapp phone from user
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId),
            columns: { whatsappPhone: true }
        });

        return ApiHandler.success({
            ...fromStoredPreferences(prefs),
            whatsappPhone: user?.whatsappPhone || null
        });
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) return ApiHandler.error(new Error("Unauthorized"), { status: 401 });

        const body = await req.json();
        const { whatsappPhone } = phoneSchema.parse(body);
        const patch = normalizePreferenceInput(body);

        if (whatsappPhone === undefined && !hasPreferenceInput(patch)) {
            return ApiHandler.error(
                new Error("No hay preferencias ni teléfono que guardar"),
                { status: 400 }
            );
        }

        // Update WhatsApp phone if provided
        if (whatsappPhone !== undefined) {
            await db.update(users)
                .set({ whatsappPhone, updatedAt: new Date() })
                .where(eq(users.id, userId));
        }

        const existingPrefs = await db.query.notificationPreferences.findFirst({
            where: eq(notificationPreferences.userId, userId),
        });

        const merged = { ...fromStoredPreferences(existingPrefs), ...patch };
        const stored = toStoredPreferencesPatch(merged);

        await db
            .insert(notificationPreferences)
            .values({ userId, ...stored })
            .onConflictDoUpdate({
                target: notificationPreferences.userId,
                set: { ...stored, updatedAt: new Date() },
            });

        const user = await db.query.users.findFirst({
            where: eq(users.id, userId),
            columns: { whatsappPhone: true },
        });

        return ApiHandler.success({
            ...fromStoredPreferences(stored),
            whatsappPhone: user?.whatsappPhone ?? null,
        });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ApiHandler.error(new Error(`Validation failed: ${error.issues.map(e => e.message).join(", ")}`), { status: 400 });
    }
    return ApiHandler.error(error);
  }
}
