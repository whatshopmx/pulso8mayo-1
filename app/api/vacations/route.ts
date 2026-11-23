import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { vacationRequests, vacationStatusEnum, users, branches, notifications, notificationPreferences } from "@/lib/db/schema";
import { eq, and, gte, lte, lt, or, inArray, isNull, type SQL } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { addDays, differenceInDays, parseISO } from "date-fns";
import { z } from "zod";
import { isApiError, ApiError } from "@/lib/api/error";
import { targetInScope } from "@/lib/rbac/resource-scope";
import { resolveVacationScope, vacationScopeCondition, assertVacationUserPermission } from "@/lib/services/vacation-access";
import { withVacationTransaction } from "@/lib/db/vacation-runtime";

const createSchema = z.object({
    userId: z.string().min(1).max(128), companyId: z.uuid().optional(), branchId: z.uuid().nullish(),
    startDate: z.iso.date(), endDate: z.iso.date(), reason: z.string().trim().max(2000).optional(),
}).refine(value => value.startDate <= value.endDate);
const listSchema = z.object({
    userId: z.string().min(1).max(128).optional(), companyId: z.uuid().optional(), branchId: z.uuid().optional(),
    status: z.enum(vacationStatusEnum.enumValues).optional(), startDate: z.iso.date().optional(), endDate: z.iso.date().optional(),
}).refine(value => (!value.startDate && !value.endDate) ||
    Boolean(value.startDate && value.endDate && value.startDate <= value.endDate));

async function notifyManagersOfNewRequest(
    vacationId: string,
    userId: string,
    companyId: string,
    branchId: string | null,
    startDate: Date,
    endDate: Date
) {
    try {
        // Get managers for the branch (users with ADMIN or GERENTE role)
        const managers = await db.query.users.findMany({
            columns: { id: true },
            where: and(eq(users.companyId, companyId), or(
                eq(users.role, "ADMIN"), eq(users.role, "OWNER"), eq(users.role, "SUPER_ADMIN"),
                branchId ? and(eq(users.role, "GERENTE"), eq(users.branchId, branchId)) : undefined
            ))
        });

        const employee = await db.query.users.findFirst({
            columns: { name: true },
            where: and(eq(users.id, userId), eq(users.companyId, companyId))
        });

        for (const manager of managers) {
            // Create in-app notification
            await db.insert(notifications).values({
                userId: manager.id,
                title: "📋 Nueva Solicitud de Vacaciones",
                message: `${employee?.name || "Un empleado"} ha solicitado vacaciones del ${startDate.toLocaleDateString()} al ${endDate.toLocaleDateString()}`,
                type: "warning",
                actionUrl: `/dashboard/labor/vacations?id=${vacationId}`,
                actionLabel: "Revisar solicitud"
            });
        }
    } catch (error) {
        console.error("Error notifying managers:", error);
    }
}

export interface VacationRequest {
    id: string;
    userId: string;
    userName?: string;
    userEmail?: string;
    companyId: string;
    branchId?: string;
    branchName?: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "COMPLETED";
    reason?: string;
    managerComments?: string;
    rejectionReason?: string;
    requestedAt: string;
    approvedAt?: string;
    approvedBy?: string;
}

export async function GET(req: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const parsed = listSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success) return NextResponse.json({ error: "Filtros de vacaciones inválidos" }, { status: 400 });
        const { userId, branchId, status, startDate, endDate, companyId } = parsed.data;
        const scope = await resolveVacationScope(session.user, "read", branchId);
        if (companyId && companyId !== scope.companyId) throw ApiError.forbidden("Empresa fuera de tu alcance");

        // Build conditions
        const conditions: SQL[] = [];

        // Filter by user if provided (or use current user)
        if (userId) {
            conditions.push(eq(vacationRequests.userId, userId));
        }

        // Filter by branch if provided
        if (branchId) {
            conditions.push(eq(vacationRequests.branchId, branchId));
        }

        // Filter by status if provided
        if (status) {
            conditions.push(eq(vacationRequests.status, status));
        }

        // Filter by date range
        if (startDate && endDate) {
            conditions.push(
                and(gte(vacationRequests.endDate, parseISO(startDate)),
                    lt(vacationRequests.startDate, addDays(parseISO(endDate), 1)))
            );
        }

        // Fetch vacation requests with user and branch data
        const requests = await withVacationTransaction(session.user, async (tx, runtime) => tx
            .select({
                id: vacationRequests.id,
                userId: vacationRequests.userId,
                companyId: vacationRequests.companyId,
                branchId: vacationRequests.branchId,
                startDate: vacationRequests.startDate,
                endDate: vacationRequests.endDate,
                totalDays: vacationRequests.totalDays,
                status: vacationRequests.status,
                reason: vacationRequests.reason,
                managerComments: vacationRequests.managerComments,
                rejectionReason: vacationRequests.rejectionReason,
                requestedAt: vacationRequests.requestedAt,
                approvedAt: vacationRequests.approvedAt,
                approvedBy: vacationRequests.approvedBy
            })
            .from(vacationRequests)
            .where(and(vacationScopeCondition(scope, runtime), ...conditions))
            .orderBy(vacationRequests.requestedAt));

        // Catalogs stay on their existing connection. Only hydrate identities
        // already returned by the scoped writer/reader, always within company.
        if (!requests.length) return NextResponse.json({ data: [], total: 0 });
        const userIds = [...new Set(requests.map(request => request.userId))];
        const branchIds = [...new Set(requests.map(request => request.branchId).filter((id): id is string => Boolean(id)))];
        const [staff, branchNames] = await Promise.all([
            db.select({ id: users.id, name: users.name, email: users.email }).from(users)
                .where(and(eq(users.companyId, scope.companyId), inArray(users.id, userIds))),
            branchIds.length ? db.select({ id: branches.id, name: branches.name }).from(branches)
                .where(and(eq(branches.companyId, scope.companyId), inArray(branches.id, branchIds))) : Promise.resolve([]),
        ]);
        const people = new Map(staff.map(person => [person.id, person]));
        const locations = new Map(branchNames.map(location => [location.id, location.name]));

        return NextResponse.json({
            data: requests.map(request => ({ ...request, userName: people.get(request.userId)?.name,
                userEmail: people.get(request.userId)?.email, branchName: locations.get(request.branchId) })),
            total: requests.length
        });
    } catch (error) {
        if (isApiError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
        console.error("Error fetching vacation requests:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
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

        const parsed = createSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ error: "Solicitud de vacaciones inválida" }, { status: 400 });
        const { userId, startDate, endDate, reason } = parsed.data;
        const scope = await resolveVacationScope(session.user, "write", parsed.data.branchId);
        if (parsed.data.companyId && parsed.data.companyId !== scope.companyId) throw ApiError.forbidden("Empresa fuera de tu alcance");
        assertVacationUserPermission(session.user, userId);
        const employee = await db.query.users.findFirst({
            columns: { id: true, companyId: true, branchId: true },
            where: and(eq(users.id, userId), eq(users.companyId, scope.companyId), isNull(users.deletedAt)),
        });
        if (!employee || !targetInScope(scope, { ...employee, userId: employee.id })) throw ApiError.notFound("Empleado no encontrado");
        const companyId = scope.companyId;
        const branchId = employee.branchId;
        if (parsed.data.branchId && parsed.data.branchId !== branchId) throw ApiError.forbidden("La sucursal no corresponde al empleado");
        if (branchId && !await db.query.branches.findFirst({
            columns: { id: true }, where: and(eq(branches.id, branchId), eq(branches.companyId, companyId)),
        })) throw ApiError.forbidden("La sucursal del empleado no pertenece a la empresa");

        // Calculate total days
        const start = parseISO(startDate);
        const end = parseISO(endDate);
        const totalDays = differenceInDays(end, start) + 1;

        if (totalDays <= 0) {
            return NextResponse.json(
                { error: "La fecha de fin debe ser posterior a la fecha de inicio" },
                { status: 400 }
            );
        }

        // Check for overlapping vacations
        const newRequest = await withVacationTransaction(session.user, async (tx, runtime) => {
            const overlapping = await tx.query.vacationRequests.findFirst({
                where: and(
                    vacationScopeCondition(scope, runtime),
                    eq(vacationRequests.userId, userId),
                    eq(vacationRequests.companyId, companyId),
                    eq(vacationRequests.status, "APPROVED"),
                    lte(vacationRequests.startDate, end),
                    gte(vacationRequests.endDate, start)
                )
            });

            if (overlapping) {
                throw ApiError.badRequest("Ya tienes vacaciones aprobadas en este período");
            }

            // Create vacation request
            const [created] = await tx.insert(vacationRequests).values({
                userId,
                companyId,
                branchId,
                startDate: start,
                endDate: end,
                totalDays,
                status: "PENDING",
                reason: reason || null
            }).returning();
            return created;
        });

        // Notify managers of new request
        await notifyManagersOfNewRequest(
            newRequest.id,
            userId,
            companyId,
            branchId,
            start,
            end
        );

        return NextResponse.json({
            success: true,
            data: newRequest,
            message: "Solicitud de vacaciones creada exitosamente"
        });
    } catch (error) {
        if (isApiError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
        console.error("Error creating vacation request:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const scope = await resolveVacationScope(session.user, "write");
        const { searchParams } = new URL(req.url);
        const parsedId = z.uuid().safeParse(searchParams.get("id"));
        if (!parsedId.success) {
            return NextResponse.json(
                { error: "ID de solicitud requerido" },
                { status: 400 }
            );
        }
        const id = parsedId.data;

        // Get the vacation request
        const updated = await withVacationTransaction(session.user, async (tx, runtime) => {
            const request = await tx.query.vacationRequests.findFirst({
                where: and(eq(vacationRequests.id, id), vacationScopeCondition(scope, runtime))
            });

            if (!request) {
                throw ApiError.notFound("Solicitud no encontrada");
            }
            assertVacationUserPermission(session.user, request.userId);

            // Only allow cancellation if pending or approved by the same user
            if (request.status !== "PENDING" && request.status !== "APPROVED") {
                throw ApiError.conflict("Solo se pueden cancelar solicitudes pendientes o aprobadas");
            }

            // Update to cancelled
            const [cancelled] = await tx.update(vacationRequests).set({
                status: "CANCELLED",
                cancelledAt: new Date(), updatedAt: new Date(),
            }).where(and(eq(vacationRequests.id, id), vacationScopeCondition(scope, runtime), eq(vacationRequests.status, request.status))).returning();
            if (!cancelled) throw ApiError.conflict("La solicitud cambió; actualiza antes de cancelar");
            return cancelled;
        });

        return NextResponse.json({
            success: true,
            data: updated,
            message: "Solicitud de vacaciones cancelada"
        });
    } catch (error) {
        if (isApiError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
        console.error("Error deleting vacation request:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}
