import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { vacationRequests, users, notificationPreferences, notifications } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";
import { z } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { resolveVacationScope, vacationScopeCondition } from "@/lib/services/vacation-access";
import { withVacationTransaction } from "@/lib/db/vacation-runtime";
import { serializeVacationDates, vacationCivilDay } from "@/lib/services/vacation-dates";
import { recordVacationApprovalEvent } from "@/lib/services/vacation-history-decisions";

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
        const updated = await withVacationTransaction(session.user, async (tx, runtime) => {
            const request = await tx.query.vacationRequests.findFirst({
                where: and(eq(vacationRequests.id, id), vacationScopeCondition(scope, runtime))
            });

            if (!request) {
                throw ApiError.notFound("Solicitud no encontrada");
            }

            if (request.status !== "PENDING") {
                throw ApiError.conflict("Solo se pueden aprobar/rechazar solicitudes pendientes");
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

            const [decided] = await tx.update(vacationRequests).set(updateData).where(and(
                eq(vacationRequests.id, id), vacationScopeCondition(scope, runtime), eq(vacationRequests.status, "PENDING")
            )).returning();
            if (!decided) throw ApiError.conflict("La solicitud cambió; actualiza antes de decidir");
            if (action === "APPROVED") {
                await recordVacationApprovalEvent(tx, {
                    companyId: decided.companyId,
                    userId: decided.userId,
                    actorId: session.user.id,
                    vacationRequestId: decided.id,
                    startDate: decided.startDate,
                    endDate: decided.endDate,
                    totalDays: decided.totalDays,
                    reason: managerComments,
                });
            }
            return decided;
        });

        // Send notification to employee
        if (action === "APPROVED") {
            await sendVacationNotification(
                updated.userId,
                "✅ Vacaciones Aprobadas",
                `Tu solicitud de vacaciones del ${vacationCivilDay(updated.startDate)} al ${vacationCivilDay(updated.endDate)} ha sido aprobada.${managerComments ? " Comentarios: " + managerComments : ""}`,
                id
            );
        } else {
            await sendVacationNotification(
                updated.userId,
                "❌ Vacaciones Rechazadas",
                `Tu solicitud de vacaciones del ${vacationCivilDay(updated.startDate)} al ${vacationCivilDay(updated.endDate)} ha sido rechazada.${rejectionReason ? " Motivo: " + rejectionReason : ""}`,
                id
            );
        }

        return NextResponse.json({
            success: true,
            data: serializeVacationDates(updated),
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
