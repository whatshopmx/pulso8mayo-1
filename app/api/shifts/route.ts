import { NextRequest } from "next/server";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { requireTenant } from "@/lib/tenant-context";
import { db } from "@/lib/db";
import { plannedShifts, users, branches } from "@/lib/db/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod";
import { addDays, parseISO, format, isWithinInterval } from "date-fns";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

// Schema para crear un turno individual
const createShiftSchema = z.object({
    userId: z.string(),
    branchId: z.string().uuid(),
    shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // "YYYY-MM-DD"
    startTime: z.string().regex(/^\d{2}:\d{2}$/),       // "HH:MM"
    endTime: z.string().regex(/^\d{2}:\d{2}$/),         // "HH:MM"
    role: z.string(),
    notes: z.string().optional(),
    templateId: z.string().uuid().optional(),
});

// Schema para creación bulk de turnos
const bulkCreateShiftsSchema = z.array(z.object({
    userId: z.string(),
    branchId: z.string().uuid(),
    shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    role: z.string(),
    notes: z.string().optional(),
}));

/**
 * GET /api/shifts
 * Obtiene turnos planificados para un rango de fechas y sucursal
 * Query params: branchId, start, end, userId (opcional)
 */
export async function GET(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        
        // If user doesn't have a company assigned, return empty list
        if (!tenant.id) {
            return ApiHandler.success([]);
        }
        
        const searchParams = req.nextUrl.searchParams;
        const branchId = searchParams.get("branchId");
        const start = searchParams.get("start");
        const end = searchParams.get("end");
        const userId = searchParams.get("userId");

        if (!branchId) {
            return ApiHandler.error(ApiError.badRequest("Branch ID is required"));
        }

        // Construir where clause
        const conditions = [eq(plannedShifts.branchId, branchId)];
        
        if (start) {
            conditions.push(gte(plannedShifts.shiftDate, start));
        }
        
        if (end) {
            conditions.push(lte(plannedShifts.shiftDate, end));
        }
        
        if (userId) {
            conditions.push(eq(plannedShifts.userId, userId));
        }

        const rawShifts = await db.query.plannedShifts.findMany({
            where: and(...conditions),
            orderBy: (shifts, { asc }) => [asc(shifts.shiftDate), asc(shifts.startTime)],
        });

        // Transform to include user and branch data, and combine date/time
        const shiftsWithDetails = await Promise.all(
            rawShifts.map(async (shift) => {
                const user = await db.query.users.findFirst({
                    where: eq(users.id, shift.userId),
                    columns: { name: true, image: true }
                });

                const branch = await db.query.branches.findFirst({
                    where: eq(branches.id, shift.branchId),
                    columns: { name: true }
                });

                // Combine shiftDate and startTime/endTime into ISO datetime strings
                const startDateTime = new Date(`${shift.shiftDate}T${shift.startTime}`);
                const endDateTime = new Date(`${shift.shiftDate}T${shift.endTime}`);

                return {
                    id: shift.id,
                    companyId: shift.companyId,
                    userId: shift.userId,
                    userName: user?.name || 'Unknown User',
                    branchId: shift.branchId,
                    branchName: branch?.name || 'Unknown Branch',
                    role: shift.role,
                    startTime: startDateTime.toISOString(),
                    endTime: endDateTime.toISOString(),
                    date: shift.shiftDate,
                    status: shift.status as "DRAFT" | "PUBLISHED",
                    notes: shift.notes,
                    templateId: shift.templateId,
                };
            })
        );

        return ApiHandler.success(shiftsWithDetails);
    } catch (error) {
        console.error("Error fetching shifts:", error);
        return ApiHandler.error(error);
    }
}

/**
 * POST /api/shifts
 * Crea uno o múltiples turnos planificados
 * Body: Shift | Shift[]
 */
export async function POST(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        
        // If user doesn't have a company assigned, reject the request
        if (!tenant.id) {
            return ApiHandler.error(ApiError.forbidden("Company not assigned to user"));
        }
        
        const body = await req.json();
        
        // Determinar si es bulk o individual
        const isArray = Array.isArray(body);
        const data = isArray
            ? bulkCreateShiftsSchema.parse(body)
            : [createShiftSchema.parse(body)];

        // Validaciones por cada turno
        const validatedShifts = [];
        for (const shiftData of data) {
            // 1. Verificar que el usuario existe
            const user = await db.query.users.findFirst({
                where: eq(users.id, shiftData.userId),
            });

            if (!user) {
                return ApiHandler.error(ApiError.notFound(`Usuario no encontrado: ${shiftData.userId}`));
            }

            // 2. Verificar que la sucursal existe y pertenece a la compañía del tenant
            const branch = await db.query.branches.findFirst({
                where: and(
                    eq(branches.id, shiftData.branchId),
                    eq(branches.companyId, tenant.id!)
                ),
            });

            if (!branch) {
                return ApiHandler.error(ApiError.forbidden("Sucursal no encontrada o no pertenece a tu compañía"));
            }

            // 3. Validar que endTime > startTime (para turnos del mismo día)
            const startHour = parseInt(shiftData.startTime.replace(":", ""));
            const endHour = parseInt(shiftData.endTime.replace(":", ""));
            
            // Permitir turnos nocturnos que cruzan medianoche (ej: 23:00 - 07:00)
            if (startHour > endHour && startHour < 2000) {
                // Turno nocturno válido (ej: 23:00 - 07:00)
            } else if (startHour >= endHour) {
                return ApiHandler.error(ApiError.badRequest("La hora de fin debe ser posterior a la hora de inicio"));
            }

            // 4. Validar que el turno no exceda 12 horas (límite legal)
            const startMinutes = (Math.floor(startHour / 100) * 60) + (startHour % 100);
            let endMinutes = (Math.floor(endHour / 100) * 60) + (endHour % 100);
            
            if (startHour > endHour) {
                // Turno nocturno
                endMinutes += (24 * 60);
            }
            
            const hoursDiff = (endMinutes - startMinutes) / 60;

            if (hoursDiff > 12) {
                return ApiHandler.error(
                    ApiError.badRequest(`El turno de ${hoursDiff.toFixed(1)} horas excede el límite legal de 12 horas`)
                );
            }

            // 5. Verificar conflictos con turnos existentes del mismo usuario en la misma fecha
            const existingShifts = await db.query.plannedShifts.findMany({
                where: and(
                    eq(plannedShifts.userId, shiftData.userId),
                    eq(plannedShifts.shiftDate, shiftData.shiftDate)
                ),
            });

            for (const existing of existingShifts) {
                if (existing.status === "CANCELLED") continue;

                const existingStart = parseInt(existing.startTime.replace(":", ""));
                const existingEnd = parseInt(existing.endTime.replace(":", ""));
                const newStart = startHour;
                const newEnd = endHour;

                // Verificar superposición
                const hasOverlap = !(newEnd <= existingStart || newStart >= existingEnd);
                
                if (hasOverlap) {
                    return ApiHandler.error(
                        ApiError.badRequest(`Conflicto: El usuario ya tiene un turno de ${existing.startTime} a ${existing.endTime} ese día`)
                    );
                }
            }

            validatedShifts.push({
                ...shiftData,
                companyId: tenant.id!,
                status: "DRAFT" as const,
                createdBy: tenant.userId,
            });
        }

        // Insertar turnos validados
        const newShifts = await db.insert(plannedShifts).values(validatedShifts).returning();

        return ApiHandler.success({
            shifts: newShifts,
            count: newShifts.length,
        });
    } catch (error) {
        console.error("Error creating shifts:", error);
        if (error instanceof z.ZodError) {
            return ApiHandler.error(ApiError.badRequest(`Validación fallida: ${error.issues.map(issue => issue.message).join(", ")}`));
        }
        return ApiHandler.error(error as Error);
    }
}

/**
 * PUT /api/shifts
 * Actualiza uno o múltiples turnos planificados
 * Body: { shifts: ShiftUpdate[] } o ShiftUpdate para individual
 */
export async function PUT(req: NextRequest) {
    try {
        const tenant = await requireTenant();

        // If user doesn't have a company assigned, reject the request
        if (!tenant.id) {
            return ApiHandler.error(ApiError.forbidden("Company not assigned to user"));
        }

        const body = await req.json();

        // Determinar si es bulk o individual
        const isArray = Array.isArray(body.shifts || body);
        const data = isArray ? body.shifts : [body];

        const updateSchema = z.object({
            id: z.string().uuid(),
            status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).optional(),
            notes: z.string().optional(),
            role: z.string().optional(),
            startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
            endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        });

        const validatedUpdates = updateSchema.array().parse(data);

        // Validar permisos y existencia
        const updatedShifts = [];
        for (const update of validatedUpdates) {
            const existing = await db.query.plannedShifts.findFirst({
                where: eq(plannedShifts.id, update.id),
            });

            if (!existing) {
                return ApiHandler.error(ApiError.notFound(`Turno no encontrado: ${update.id}`));
            }

            // Verificar que pertenece a la compañía
            const branch = await db.query.branches.findFirst({
                where: and(
                    eq(branches.id, existing.branchId),
                    eq(branches.companyId, tenant.id!)
                ),
            });

            if (!branch) {
                return ApiHandler.error(ApiError.forbidden("No tienes permiso para modificar este turno"));
            }

            // Aplicar validaciones si se actualizan horas
            if (update.startTime || update.endTime) {
                const startTime = update.startTime || existing.startTime;
                const endTime = update.endTime || existing.endTime;

                const startHour = parseInt(startTime.replace(":", ""));
                const endHour = parseInt(endTime.replace(":", ""));

                if (startHour > endHour && startHour < 2000) {
                    // Turno nocturno válido
                } else if (startHour >= endHour) {
                    return ApiHandler.error(ApiError.badRequest("La hora de fin debe ser posterior a la hora de inicio"));
                }

                const startMinutes = (Math.floor(startHour / 100) * 60) + (startHour % 100);
                let endMinutes = (Math.floor(endHour / 100) * 60) + (endHour % 100);
                
                if (startHour > endHour) {
                    endMinutes += (24 * 60);
                }
                
                const hoursDiff = (endMinutes - startMinutes) / 60;

                if (hoursDiff > 12) {
                    return ApiHandler.error(
                        ApiError.badRequest(`El turno de ${hoursDiff.toFixed(1)} horas excede el límite legal de 12 horas`)
                    );
                }
            }

            // Actualizar
            const [updated] = await db.update(plannedShifts)
                .set({
                    ...update,
                    updatedAt: new Date()
                })
                .where(eq(plannedShifts.id, update.id))
                .returning();

            updatedShifts.push(updated);
        }

        // Send notifications for newly published shifts
        const newlyPublished = updatedShifts.filter(s => s.status === "PUBLISHED");
        if (newlyPublished.length > 0) {
            await notifyEmployeesOfPublishedShifts(newlyPublished);
        }

        return ApiHandler.success({
            shifts: updatedShifts,
            count: updatedShifts.length,
        });
    } catch (error) {
        console.error("Error updating shifts:", error);
        if (error instanceof z.ZodError) {
            return ApiHandler.error(ApiError.badRequest(`Validación fallida: ${error.issues.map(issue => issue.message).join(", ")}`));
        }
        return ApiHandler.error(error as Error);
    }
}

/**
 * DELETE /api/shifts
 * Elimina un turno planificado por ID
 * Query params: id
 */
export async function DELETE(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        
        // If user doesn't have a company assigned, reject the request
        if (!tenant.id) {
            return ApiHandler.error(ApiError.forbidden("Company not assigned to user"));
        }
        
        const searchParams = req.nextUrl.searchParams;
        const id = searchParams.get("id");

        if (!id) {
            return ApiHandler.error(ApiError.badRequest("Shift ID is required"));
        }

        // Verificar que el turno existe
        const shift = await db.query.plannedShifts.findFirst({
            where: eq(plannedShifts.id, id),
        });

        if (!shift) {
            return ApiHandler.error(ApiError.notFound("Turno no encontrado"));
        }

        // En lugar de eliminar, marcamos como CANCELLED
        const [updatedShift] = await db.update(plannedShifts)
            .set({ status: "CANCELLED", updatedAt: new Date() })
            .where(eq(plannedShifts.id, id))
            .returning();

        return ApiHandler.success(updatedShift);
    } catch (error) {
        console.error("Error deleting shift:", error);
        return ApiHandler.error(error);
    }
}

/**
 * Send notifications to employees when their shifts are published
 */
async function notifyEmployeesOfPublishedShifts(shifts: any[]) {
    const payloads = await Promise.all(
        shifts.map(async (shift) => {
            const user = await db.query.users.findFirst({
                where: eq(users.id, shift.userId),
            });
            const branch = await db.query.branches.findFirst({
                where: eq(branches.id, shift.branchId),
            });

            return {
                userId: shift.userId,
                title: 'Nuevo Turno Asignado',
                message: `Se te ha asignado un turno: ${shift.role} el ${shift.shiftDate} de ${shift.startTime} a ${shift.endTime}`,
                type: 'info' as const,
                eventType: 'schedule_change' as const,
                actionUrl: `/dashboard/labor/shifts`,
                actionLabel: 'Ver turnos',
                metadata: {
                    changeDescription: `Nuevo turno asignado: ${shift.role} el ${shift.shiftDate} de ${shift.startTime} a ${shift.endTime} en ${branch?.name || 'Sucursal'}`,
                },
            };
        })
    );

    await NotificationDispatcher.sendBatchNotifications(payloads);
}
