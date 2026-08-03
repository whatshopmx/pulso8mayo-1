import { NextRequest } from "next/server";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant } from "@/lib/tenant-context";
import { db } from "@/lib/db";
import { employeeCommunications, communicationReadReceipts } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * POST /api/communications/announcements/{id}/read
 * Registra la confirmación de lectura del usuario autenticado (idempotente).
 * El userId proviene de la sesión, nunca del body (per reglas de requireTenantAuth).
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
    try {
        const tenant = await requireTenant();
        if (!tenant.id || !tenant.userId) {
            return ApiHandler.error(new Error("Unauthorized"), 401);
        }

        const { id: announcementId } = await params;

        // Verificar que el anuncio exista y pertenezca al tenant
        const [announcement] = await db
            .select({ id: employeeCommunications.id, companyId: employeeCommunications.companyId })
            .from(employeeCommunications)
            .where(eq(employeeCommunications.id, announcementId))
            .limit(1);

        if (!announcement) {
            return ApiHandler.error(new Error("Anuncio no encontrado"), 404);
        }
        if (announcement.companyId !== tenant.id) {
            return ApiHandler.error(new Error("Forbidden"), 403);
        }

        // Idempotencia: ¿ya existe recibo para este usuario?
        const [existing] = await db
            .select({ readAt: communicationReadReceipts.readAt })
            .from(communicationReadReceipts)
            .where(
                and(
                    eq(communicationReadReceipts.communicationId, announcementId),
                    eq(communicationReadReceipts.userId, tenant.userId)
                )
            )
            .limit(1);

        let alreadyRead = true;
        let readAt: Date | null = existing?.readAt ?? null;

        if (!existing) {
            alreadyRead = false;
            readAt = new Date();
            await db.insert(communicationReadReceipts).values({
                communicationId: announcementId,
                userId: tenant.userId,
                readAt,
            });
            // Incrementar contador agregado
            await db
                .update(employeeCommunications)
                .set({
                    readCount: sql`${employeeCommunications.readCount} + 1`,
                    updatedAt: new Date(),
                })
                .where(eq(employeeCommunications.id, announcementId));
        }

        // Retornar conteos actualizados para refrescar la métrica de la UI
        const [updated] = await db
            .select({
                readCount: employeeCommunications.readCount,
                totalRecipients: employeeCommunications.totalRecipients,
            })
            .from(employeeCommunications)
            .where(eq(employeeCommunications.id, announcementId))
            .limit(1);

        return ApiHandler.success({
            alreadyRead,
            readAt,
            readCount: updated?.readCount ?? 0,
            totalRecipients: updated?.totalRecipients ?? 0,
        });
    } catch (error) {
        console.error("Error marking announcement as read:", error);
        return ApiHandler.error(error);
    }
}