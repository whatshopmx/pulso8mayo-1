import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { vacationRequests, users, notificationPreferences, notifications } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";
import { z } from "zod";
import { isApiError } from "@/lib/api/error";
import { resolveVacationScope, vacationScopeCondition } from "@/lib/services/vacation-access";

const decisionSchema = z.object({
    id: z.uuid(), action: z.enum(["APPROVED", "REJECTED"]),
    managerComments: z.string().trim().max(2000).optional(),
    rejectionReason: z.string().trim().max(2000).optional(),
});

async function createNotification(
    userId: string,
    title: string,
    message: string,
    type: "info" | "warning" | "error" | "success",
    actionUrl?: string
) {
    try {
        await db.insert(notifications).values({
            userId,
            title,
            message,
            type,
            actionUrl,
            actionLabel: "Ver detalles"
        });
    } catch (error) {
        console.error("Error creating notification:", error);
    }
}

async function sendVacationNotification(
  userId: string,
  subject: string,
  message: string,
  vacationId: string
) {
  try {
    await NotificationDispatcher.sendNotification({
      userId,
      title: subject,
      message,
      type: "info",
      eventType: "shift_approval_decision",
      actionUrl: `/dashboard/labor/vacations?id=${vacationId}`,
      actionLabel: "Ver detalles",
      metadata: {
        decision: subject.includes("Aprobadas") ? "Aprobada" : "Rechazada",
        approvalType: "Vacaciones",
      },
    });
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const scope = await resolveVacationScope(session.user, "decide");
        const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ error: "Solicitud de decisión inválida" }, { status: 400 });
        const { id, action, managerComments, rejectionReason } = parsed.data;

        // Get the vacation request
        const request = await db.query.vacationRequests.findFirst({
            where: and(eq(vacationRequests.id, id), vacationScopeCondition(scope))
        });

        if (!request) {
            return NextResponse.json(
                { error: "Solicitud no encontrada" },
                { status: 404 }
            );
        }

        if (request.status !== "PENDING") {
            return NextResponse.json(
                { error: "Solo se pueden aprobar/rechazar solicitudes pendientes" },
                { status: 409 }
            );
        }

        // Update based on action
        const updateData: Partial<typeof vacationRequests.$inferInsert> = {
            status: action,
            updatedAt: new Date(),
        };

        if (action === "APPROVED") {
            updateData.approvedBy = session.user.id;
            updateData.approvedAt = new Date();
            updateData.managerComments = managerComments || null;
        } else if (action === "REJECTED") {
            updateData.rejectionReason = rejectionReason || null;
            updateData.rejectedBy = session.user.id;
            updateData.rejectedAt = new Date();
        }

        const [updated] = await db.update(vacationRequests).set(updateData).where(and(
            eq(vacationRequests.id, id), vacationScopeCondition(scope), eq(vacationRequests.status, "PENDING")
        )).returning();
        if (!updated) return NextResponse.json({ error: "La solicitud cambió; actualiza antes de decidir" }, { status: 409 });

        // Send notification to employee
        if (action === "APPROVED") {
            await sendVacationNotification(
                request.userId,
                "✅ Vacaciones Aprobadas",
                `Tu solicitud de vacaciones del ${new Date(request.startDate).toLocaleDateString()} al ${new Date(request.endDate).toLocaleDateString()} ha sido aprobada.${managerComments ? " Comentarios: " + managerComments : ""}`,
                id
            );
        } else {
            await sendVacationNotification(
                request.userId,
                "❌ Vacaciones Rechazadas",
                `Tu solicitud de vacaciones del ${new Date(request.startDate).toLocaleDateString()} al ${new Date(request.endDate).toLocaleDateString()} ha sido rechazada.${rejectionReason ? " Motivo: " + rejectionReason : ""}`,
                id
            );
        }

        return NextResponse.json({
            success: true,
            data: updated,
            message: `Solicitud ${action === "APPROVED" ? "aprobada" : "rechazada"} exitosamente`
        });
    } catch (error) {
        if (isApiError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
        console.error("Error processing vacation request:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}
