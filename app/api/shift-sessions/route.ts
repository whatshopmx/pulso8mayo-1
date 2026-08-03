import { NextRequest } from "next/server";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { requireTenant } from "@/lib/tenant-context";
import { db } from "@/lib/db";
import { shiftSessions, users, branches, plannedShifts, breakLogs, employeeProfiles } from "@/lib/db/schema";
import { eq, and, gte, lte, inArray, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { parseISO, differenceInMinutes, format, addDays } from "date-fns";
import { calculateOvertime, validateBreakCompliance, DEFAULT_COMPLIANCE_RULES } from "@/lib/labor-validation";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

const createShiftSessionSchema = z.object({
    plannedShiftId: z.string().uuid().optional(),
    userId: z.string(),
    branchId: z.string().uuid(),
    scheduledStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    scheduledEndTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const updateShiftSessionSchema = z.object({
  id: z.string().uuid(),
  checkInTime: z.string().datetime().optional(),
  checkOutTime: z.string().datetime().optional(),
  totalBreakMinutes: z.number().optional(),
  totalWorkMinutes: z.number().optional(),
  lateMinutes: z.number().optional(),
  earlyDepartureMinutes: z.number().optional(),
  requiresApproval: z.boolean().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "NO_SHOW", "CANCELLED"]).optional(),
  notes: z.string().optional(),
});

const logBreakSchema = z.object({
    sessionId: z.string().uuid(),
    type: z.enum(["STANDARD", "MEAL", "REST", "EMERGENCY"]).default("STANDARD"),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        
        if (!tenant.id) {
            return ApiHandler.success([]);
        }
        
        const searchParams = req.nextUrl.searchParams;
        const branchId = searchParams.get("branchId");
        const userId = searchParams.get("userId");
        const start = searchParams.get("start");
        const end = searchParams.get("end");
        const status = searchParams.get("status");

        const conditions = [];
        
        if (branchId) {
            conditions.push(eq(shiftSessions.branchId, branchId));
        }
        
        if (userId) {
            conditions.push(eq(shiftSessions.userId, userId));
        }
        
        if (start) {
            conditions.push(gte(shiftSessions.startedAt, new Date(start)));
        }
        
        if (end) {
            conditions.push(lte(shiftSessions.startedAt, new Date(end)));
        }
        
        if (status) {
            conditions.push(eq(shiftSessions.status, status));
        }

        const sessions = await db.query.shiftSessions.findMany({
            where: conditions.length > 0 ? and(...conditions) : undefined,
            orderBy: [desc(shiftSessions.startedAt)],
            limit: 500,
        });

        const sessionsWithDetails = await Promise.all(
            sessions.map(async (session) => {
                const user = await db.query.users.findFirst({
                    where: eq(users.id, session.userId),
                    columns: { name: true, image: true }
                });

                const breaks = await db.query.breakLogs.findMany({
                    where: eq(breakLogs.sessionId, session.id),
                });

                const scheduledShift = session.plannedShiftId 
                    ? await db.query.plannedShifts.findFirst({
                        where: eq(plannedShifts.id, session.plannedShiftId),
                    })
                    : null;

                return {
                    ...session,
                    userName: user?.name || 'Unknown User',
                    userImage: user?.image,
                    breakLogs: breaks,
                    scheduledShift: scheduledShift ? {
                        date: scheduledShift.shiftDate,
                        startTime: scheduledShift.startTime,
                        endTime: scheduledShift.endTime,
                        role: scheduledShift.role,
                    } : null,
                };
            })
        );

        return ApiHandler.success(sessionsWithDetails);
    } catch (error) {
        console.error("Error fetching shift sessions:", error);
        return ApiHandler.error(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        
        if (!tenant.id) {
            return ApiHandler.error(ApiError.forbidden("Company not assigned to user"));
        }

        const body = await req.json();
        
        let data;
        const isArray = Array.isArray(body);
        
        if (isArray) {
            data = createShiftSessionSchema.array().parse(body);
        } else {
            data = [createShiftSessionSchema.parse(body)];
        }

        const validatedSessions = [];
        
        for (const sessionData of data) {
            const user = await db.query.users.findFirst({
                where: eq(users.id, sessionData.userId),
            });

            if (!user) {
                return ApiHandler.error(ApiError.notFound(`Usuario no encontrado: ${sessionData.userId}`));
            }

            const branch = await db.query.branches.findFirst({
                where: and(
                    eq(branches.id, sessionData.branchId),
                    eq(branches.companyId, tenant.id!)
                ),
            });

            if (!branch) {
                return ApiHandler.error(ApiError.forbidden("Sucursal no encontrada"));
            }

            validatedSessions.push({
                ...sessionData,
                status: "PENDING",
                startedAt: new Date(),
            });
        }

        const newSessions = await db.insert(shiftSessions).values(validatedSessions).returning();

        return ApiHandler.success({
            sessions: newSessions,
            count: newSessions.length,
        });
    } catch (error) {
        console.error("Error creating shift session:", error);
        if (error instanceof z.ZodError) {
            return ApiHandler.error(ApiError.badRequest(`Validación fallida: ${error.issues.map(i => i.message).join(", ")}`));
        }
        return ApiHandler.error(error as Error);
    }
}

export async function PUT(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        
        if (!tenant.id) {
            return ApiHandler.error(ApiError.forbidden("Company not assigned to user"));
        }

        const body = await req.json();
        const data = updateShiftSessionSchema.parse(body);

        const existing = await db.query.shiftSessions.findFirst({
            where: eq(shiftSessions.id, data.id),
        });

        if (!existing) {
            return ApiHandler.error(ApiError.notFound("Sesión no encontrada"));
        }

        const updateData: any = { ...data };
        
        if (data.checkInTime && !data.checkOutTime) {
            updateData.status = "ACTIVE";
        }
        
        if (data.checkOutTime && data.checkInTime) {
            updateData.status = "COMPLETED";
            
            const checkIn = new Date(data.checkInTime);
            const checkOut = new Date(data.checkOutTime);
            const scheduledMinutes = data.totalWorkMinutes || existing.totalWorkMinutes || 0;
            const breakMinutes = data.totalBreakMinutes || existing.totalBreakMinutes || 0;
            
            const workedMinutes = differenceInMinutes(checkOut, checkIn) - breakMinutes;
            const overtime = calculateOvertime(workedMinutes, 0);
            const breakValidation = validateBreakCompliance(workedMinutes, breakMinutes);
            
            updateData.totalWorkMinutes = workedMinutes;
            updateData.overtimeMinutes = overtime.totalMinutes;
            updateData.endedAt = new Date();
            
      if (!breakValidation.isCompliant) {
        updateData.complianceFlags = {
          ...(existing.complianceFlags as object || {}),
          missedBreak: true,
          breakNotes: breakValidation.message,
        };
      }
            
            if (workedMinutes > 480) {
                updateData.requiresApproval = true;
            }
        }

        const [updated] = await db.update(shiftSessions)
            .set(updateData)
            .where(eq(shiftSessions.id, data.id))
            .returning();

        // Check if status changed to NO_SHOW to dispatch absence notifications
        if (updated.status === "NO_SHOW" && existing.status !== "NO_SHOW") {
            try {
                // Fetch employee user
                const employeeUser = await db.query.users.findFirst({
                    where: eq(users.id, existing.userId),
                });

                // Fetch planned shift details
                const shift = existing.plannedShiftId
                    ? await db.query.plannedShifts.findFirst({
                        where: eq(plannedShifts.id, existing.plannedShiftId),
                    })
                    : null;

                const shiftDate = shift?.shiftDate || (existing.startedAt ? new Date(existing.startedAt).toLocaleDateString('es-MX') : 'N/A');
                const shiftTime = shift ? `${shift.startTime} - ${shift.endTime}` : (existing.scheduledStartTime && existing.scheduledEndTime ? `${existing.scheduledStartTime} - ${existing.scheduledEndTime}` : 'N/A');
                const reason = data.notes || existing.notes || 'Sin especificar';
                const employeePhone = employeeUser?.whatsappPhone || employeeUser?.phone || 'No registrado';

                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
                const sessionSmartLinkUrl = `${baseUrl}/dashboard/labor/attendance?sessionId=${existing.id}`;
                const absenceMetadata = {
                    employeeName: employeeUser?.name || 'Empleado',
                    shiftDate,
                    shiftTime,
                    reason,
                    smartLinkUrl: sessionSmartLinkUrl,
                };
                const absenceActionUrl = `/dashboard/labor/attendance?sessionId=${existing.id}`;

                // 1. Notify the employee
                await NotificationDispatcher.sendNotification({
                    userId: existing.userId,
                    title: "Ausencia Registrada",
                    message: `Se ha registrado una ausencia (No Show) en tu turno del ${shiftDate} (${shiftTime}).`,
                    type: "warning",
                    eventType: "employee_absence",
                    actionUrl: `/dashboard/labor/shifts`,
                    actionLabel: "Ver Turnos",
                    metadata: {
                        employeeName: employeeUser?.name || 'Empleado',
                        shiftDate,
                        shiftTime,
                        reason,
                        smartLinkUrl: `${baseUrl}/dashboard/labor/shifts`,
                    }
                });

                // 2. Notify the supervisor if exists
                const employeeProfile = await db.query.employeeProfiles.findFirst({
                    where: eq(employeeProfiles.userId, existing.userId),
                });

                if (employeeProfile?.supervisorId) {
                    await NotificationDispatcher.sendNotification({
                        userId: employeeProfile.supervisorId,
                        title: `Ausencia de Empleado: ${employeeUser?.name || 'Empleado'}`,
                        message: `Se ha registrado una ausencia para ${employeeUser?.name || 'Empleado'} en el turno del ${shiftDate} (${shiftTime}). Motivo: ${reason}. Contacto: ${employeePhone}`,
                        type: "warning",
                        eventType: "employee_absence",
                        actionUrl: absenceActionUrl,
                        actionLabel: "Ver Asistencia",
                        metadata: absenceMetadata
                    });
                }

                // 3. Notify managers/admins of the branch
                const managers = await db.query.users.findMany({
                    where: and(
                        eq(users.branchId, existing.branchId),
                        inArray(users.role, ['ADMIN', 'GERENTE', 'SUPERVISOR'] as any)
                    )
                });

                for (const manager of managers) {
                    // Skip if manager is also the supervisor (to avoid duplicate notifications)
                    if (manager.id === employeeProfile?.supervisorId) continue;

                    await NotificationDispatcher.sendNotification({
                        userId: manager.id,
                        title: `Ausencia de Empleado: ${employeeUser?.name || 'Empleado'}`,
                        message: `Se ha registrado una ausencia para ${employeeUser?.name || 'Empleado'} en el turno del ${shiftDate} (${shiftTime}). Motivo: ${reason}. Contacto: ${employeePhone}`,
                        type: "warning",
                        eventType: "employee_absence",
                        actionUrl: absenceActionUrl,
                        actionLabel: "Ver Asistencia",
                        metadata: absenceMetadata
                    });
                }
            } catch (notifErr) {
                console.error("Error sending absence notifications:", notifErr);
            }
        }

        return ApiHandler.success(updated);
    } catch (error) {
        console.error("Error updating shift session:", error);
        if (error instanceof z.ZodError) {
            return ApiHandler.error(ApiError.badRequest(`Validación fallida: ${error.issues.map(i => i.message).join(", ")}`));
        }
        return ApiHandler.error(error as Error);
    }
}