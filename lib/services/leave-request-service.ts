import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api/error";
import { branches, leaveBalances, leaveRequests, leaveRequestStatusEnum, leaveTypes, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { type Role } from "@/lib/permissions";
import { resolveResourceScope, targetInScope } from "@/lib/rbac/resource-scope";
import { serializeVacationDates, vacationCivilDay, vacationDate } from "@/lib/services/vacation-dates";
import { recordLeaveApprovalEvent, recordLeaveCancellationEvent } from "@/lib/services/vacation-history-decisions";

export interface LeaveActor {
  userId: string;
  companyId: string;
}

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
const DECISION_ROLES = new Set<Role>(["SUPER_ADMIN", "OWNER", "ADMIN", "GERENTE"]);
const COMPANY_DECISION_ROLES = new Set<Role>(["SUPER_ADMIN", "OWNER", "ADMIN"]);

const civilDayInput = z.string().trim().min(10).max(40).transform((value, ctx) => {
  try {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error("invalid");
    return vacationCivilDay(normalized);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fecha civil inválida" });
    return z.NEVER;
  }
});

export const listLeaveRequestsQuerySchema = z.object({
  userId: z.string().trim().min(1).max(255).optional(),
  leaveTypeId: z.string().uuid().optional(),
  status: z.enum(leaveRequestStatusEnum.enumValues).optional(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
  message: "Rango de fechas inválido",
});

export const createLeaveRequestSchema = z.object({
  branchId: z.string().uuid().nullish(),
  leaveTypeId: z.string().uuid(),
  startDate: civilDayInput,
  endDate: civilDayInput,
  totalDays: z.number().int().min(1).max(366).optional(),
  reason: z.string().trim().min(1).max(2000),
  supportingDocumentId: z.string().uuid().optional(),
}).strict().refine(value => value.startDate <= value.endDate, {
  message: "La fecha de fin debe ser igual o posterior a la fecha de inicio",
});

export const rejectLeaveRequestSchema = z.object({
  rejectionReason: z.string().trim().min(1).max(2000),
}).strict();

export const approveLeaveRequestSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
}).strict().optional();

async function loadActor(tx: Tx, actor: LeaveActor) {
  const [row] = await tx.select({
    id: users.id,
    role: users.role,
    companyId: users.companyId,
    branchId: users.branchId,
  }).from(users).where(and(
    eq(users.id, actor.userId),
    eq(users.companyId, actor.companyId),
    isNull(users.deletedAt),
  )).for("share");
  if (!row) throw ApiError.forbidden("La cuenta ya no tiene acceso a esta empresa.");
  return row;
}

async function lockBalanceKey(tx: Tx, companyId: string, userId: string, leaveTypeId: string, year: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([companyId, userId, leaveTypeId, year])}, 0))`);
}

function requestYear(startDate: Date | string): number {
  return Number(vacationCivilDay(startDate).slice(0, 4));
}

export async function listLeaveRequests(actor: LeaveActor, rawQuery: z.infer<typeof listLeaveRequestsQuerySchema>) {
  const query = listLeaveRequestsQuerySchema.parse(rawQuery);
  return withCompanyContext({ companyId: actor.companyId, actorId: actor.userId }, async tx => {
    const current = await loadActor(tx, actor);
    const catalog = await tx.select({ id: branches.id, companyId: branches.companyId })
      .from(branches).where(eq(branches.companyId, actor.companyId));
    const scope = resolveResourceScope(
      { userId: current.id, role: current.role as Role, companyId: current.companyId, branchId: current.branchId },
      "users",
      "read",
      catalog,
    );
    if (scope.kind === "NONE") throw ApiError.forbidden("No hay un alcance autorizado para consultar permisos.");

    const conditions: SQL[] = [eq(leaveRequests.companyId, actor.companyId)];
    if (scope.kind === "OWN") {
      if (query.userId && query.userId !== current.id) throw ApiError.notFound("No se encontró el colaborador.");
      conditions.push(eq(leaveRequests.userId, current.id));
    } else if (scope.kind === "BRANCH" && scope.branchId) {
      conditions.push(eq(leaveRequests.branchId, scope.branchId));
      if (query.userId) {
        const [target] = await tx.select({ userId: users.id, companyId: users.companyId, branchId: users.branchId })
          .from(users).where(and(eq(users.id, query.userId), eq(users.companyId, actor.companyId), isNull(users.deletedAt)));
        if (!target || !targetInScope(scope, target)) throw ApiError.notFound("No se encontró el colaborador.");
        conditions.push(eq(leaveRequests.userId, query.userId));
      }
    } else if (query.userId) {
      conditions.push(eq(leaveRequests.userId, query.userId));
    }

    if (query.leaveTypeId) conditions.push(eq(leaveRequests.leaveTypeId, query.leaveTypeId));
    if (query.status) conditions.push(eq(leaveRequests.status, query.status));
    if (query.startDate) conditions.push(gte(leaveRequests.endDate, vacationDate(query.startDate)));
    if (query.endDate) conditions.push(lte(leaveRequests.startDate, new Date(`${query.endDate}T23:59:59.999Z`)));

    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(leaveRequests).where(and(...conditions));

    const rows = await tx.select({
      id: leaveRequests.id,
      userId: leaveRequests.userId,
      companyId: leaveRequests.companyId,
      branchId: leaveRequests.branchId,
      branchName: branches.name,
      leaveTypeId: leaveRequests.leaveTypeId,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      requestedAt: leaveRequests.requestedAt,
      approvedBy: leaveRequests.approvedBy,
      approvedAt: leaveRequests.approvedAt,
      rejectedBy: leaveRequests.rejectedBy,
      rejectedAt: leaveRequests.rejectedAt,
      rejectionReason: leaveRequests.rejectionReason,
      createdAt: leaveRequests.createdAt,
      userName: users.name,
      userPhoto: users.image,
      leaveTypeName: leaveTypes.name,
    })
      .from(leaveRequests)
      .leftJoin(users, and(eq(leaveRequests.userId, users.id), eq(users.companyId, actor.companyId)))
      .leftJoin(leaveTypes, and(eq(leaveRequests.leaveTypeId, leaveTypes.id), eq(leaveTypes.companyId, actor.companyId)))
      .leftJoin(branches, and(eq(leaveRequests.branchId, branches.id), eq(branches.companyId, actor.companyId)))
      .where(and(...conditions))
      .orderBy(desc(leaveRequests.requestedAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    return {
      requests: rows.map(row => serializeVacationDates(row)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: count,
        totalPages: Math.ceil(count / query.limit),
      },
    };
  });
}

export async function createLeaveRequest(actor: LeaveActor, rawInput: unknown) {
  const input = createLeaveRequestSchema.parse(rawInput);
  const start = vacationDate(input.startDate);
  const end = vacationDate(input.endDate);
  const derivedDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (!Number.isSafeInteger(derivedDays) || derivedDays <= 0) {
    throw ApiError.badRequest("Rango de fechas inválido.");
  }
  if (input.totalDays !== undefined && input.totalDays !== derivedDays) {
    throw ApiError.badRequest("Los días solicitados no coinciden con el rango de fechas civiles.");
  }

  return withCompanyContext({ companyId: actor.companyId, actorId: actor.userId }, async tx => {
    const current = await loadActor(tx, actor);
    if (input.branchId && input.branchId !== current.branchId) {
      throw ApiError.forbidden("La sucursal indicada no corresponde al colaborador.");
    }
    const [leaveType] = await tx.select({ id: leaveTypes.id, name: leaveTypes.name })
      .from(leaveTypes)
      .where(and(
        eq(leaveTypes.id, input.leaveTypeId),
        eq(leaveTypes.companyId, actor.companyId),
        eq(leaveTypes.isActive, true),
      ))
      .for("share");
    if (!leaveType) throw ApiError.notFound("No se encontró el tipo de permiso activo en la empresa.");

    const year = requestYear(input.startDate);
    await lockBalanceKey(tx, actor.companyId, current.id, leaveType.id, year);

    const balanceRows = await tx.select().from(leaveBalances).where(and(
      eq(leaveBalances.userId, current.id),
      eq(leaveBalances.leaveTypeId, leaveType.id),
      eq(leaveBalances.year, year),
    )).for("update");
    if (balanceRows.length > 1) {
      throw ApiError.conflict("Existen saldos duplicados para el período; se requiere revisión.");
    }
    const balance = balanceRows[0];
    if (balance && balance.balance < derivedDays) {
      throw ApiError.conflict("Saldo insuficiente para el período solicitado.");
    }

    const [created] = await tx.insert(leaveRequests).values({
      userId: current.id,
      companyId: actor.companyId,
      branchId: current.branchId,
      leaveTypeId: leaveType.id,
      startDate: start,
      endDate: end,
      totalDays: derivedDays,
      reason: input.reason,
      supportingDocumentId: input.supportingDocumentId ?? null,
      status: "PENDING",
      createdBy: current.id,
    }).returning();

    if (balance) {
      const nextPending = (balance.pending ?? 0) + derivedDays;
      const nextBalance = balance.totalEntitlement - (balance.used ?? 0) - nextPending;
      await tx.update(leaveBalances).set({
        pending: nextPending,
        balance: nextBalance,
        updatedAt: new Date(),
      }).where(eq(leaveBalances.id, balance.id));
    }

    return serializeVacationDates(created);
  });
}

export async function decideLeaveRequest(
  actor: LeaveActor,
  requestId: string,
  action: "approve" | "reject",
  rawBody: unknown,
) {
  const validId = z.string().uuid().parse(requestId);
  const rejectBody = action === "reject" ? rejectLeaveRequestSchema.parse(rawBody) : null;
  const approveBody = action === "approve" ? approveLeaveRequestSchema.parse(rawBody ?? {}) : null;

  return withCompanyContext({ companyId: actor.companyId, actorId: actor.userId }, async tx => {
    const current = await loadActor(tx, actor);
    const role = current.role as Role;
    if (!DECISION_ROLES.has(role)) {
      throw ApiError.forbidden("No tienes permisos para autorizar o rechazar solicitudes.");
    }

    const [existing] = await tx.select({
      request: leaveRequests,
      leaveTypeName: leaveTypes.name,
    })
      .from(leaveRequests)
      .innerJoin(leaveTypes, and(eq(leaveRequests.leaveTypeId, leaveTypes.id), eq(leaveTypes.companyId, actor.companyId)))
      .where(and(eq(leaveRequests.id, validId), eq(leaveRequests.companyId, actor.companyId)))
      .for("update", { of: leaveRequests });

    if (!existing) throw ApiError.notFound("Solicitud de permiso no encontrada.");
    if (!COMPANY_DECISION_ROLES.has(role) && existing.request.branchId !== current.branchId) {
      throw ApiError.notFound("Solicitud de permiso no encontrada.");
    }
    if (existing.request.status !== "PENDING") {
      throw ApiError.conflict("Solo se pueden procesar solicitudes pendientes.");
    }

    const year = requestYear(existing.request.startDate);
    await lockBalanceKey(tx, actor.companyId, existing.request.userId, existing.request.leaveTypeId, year);

    const now = new Date();
    const updateData = action === "approve"
      ? { status: "APPROVED" as const, approvedBy: current.id, approvedAt: now, updatedBy: current.id, updatedAt: now }
      : { status: "REJECTED" as const, rejectedBy: current.id, rejectedAt: now, rejectionReason: rejectBody!.rejectionReason, updatedBy: current.id, updatedAt: now };

    const [updated] = await tx.update(leaveRequests)
      .set(updateData)
      .where(and(
        eq(leaveRequests.id, validId),
        eq(leaveRequests.companyId, actor.companyId),
        eq(leaveRequests.status, "PENDING"),
      ))
      .returning();
    if (!updated) throw ApiError.conflict("La solicitud cambió; actualiza antes de decidir.");

    const balanceRows = await tx.select().from(leaveBalances).where(and(
      eq(leaveBalances.userId, updated.userId),
      eq(leaveBalances.leaveTypeId, updated.leaveTypeId),
      eq(leaveBalances.year, year),
    )).for("update");
    const balance = balanceRows[0];
    if (balance) {
      const currentPending = balance.pending ?? 0;
      const currentUsed = balance.used ?? 0;
      const nextPending = Math.max(0, currentPending - updated.totalDays);
      const nextUsed = action === "approve" ? currentUsed + updated.totalDays : currentUsed;
      const nextBalance = balance.totalEntitlement - nextUsed - nextPending;
      await tx.update(leaveBalances).set({
        used: nextUsed,
        pending: nextPending,
        balance: nextBalance,
        updatedAt: now,
      }).where(eq(leaveBalances.id, balance.id));
    }

    if (action === "approve" && existing.leaveTypeName === "VACATION") {
      await recordLeaveApprovalEvent(tx, {
        companyId: updated.companyId,
        userId: updated.userId,
        actorId: current.id,
        leaveRequestId: updated.id,
        startDate: updated.startDate,
        endDate: updated.endDate,
        totalDays: updated.totalDays,
        reason: approveBody?.reason ?? updated.reason,
      });
    }

    return serializeVacationDates(updated);
  });
}

export async function cancelLeaveRequest(actor: LeaveActor, requestId: string) {
  const validId = z.string().uuid().parse(requestId);
  return withCompanyContext({ companyId: actor.companyId, actorId: actor.userId }, async tx => {
    const current = await loadActor(tx, actor);
    const role = current.role as Role;

    const [existing] = await tx.select({
      request: leaveRequests,
      leaveTypeName: leaveTypes.name,
    })
      .from(leaveRequests)
      .innerJoin(leaveTypes, and(eq(leaveRequests.leaveTypeId, leaveTypes.id), eq(leaveTypes.companyId, actor.companyId)))
      .where(and(eq(leaveRequests.id, validId), eq(leaveRequests.companyId, actor.companyId)))
      .for("update", { of: leaveRequests });

    if (!existing) throw ApiError.notFound("Solicitud de permiso no encontrada.");
    const isOwner = existing.request.userId === current.id;
    const isBranchManager = role === "GERENTE" && existing.request.branchId === current.branchId;
    const isCompanyAdmin = COMPANY_DECISION_ROLES.has(role);
    if (!isOwner && !isBranchManager && !isCompanyAdmin) {
      throw ApiError.forbidden("No tienes permisos para cancelar esta solicitud.");
    }
    if (existing.request.status !== "PENDING" && existing.request.status !== "APPROVED") {
      throw ApiError.conflict("Solo se pueden cancelar solicitudes pendientes o aprobadas.");
    }

    const year = requestYear(existing.request.startDate);
    await lockBalanceKey(tx, actor.companyId, existing.request.userId, existing.request.leaveTypeId, year);

    const now = new Date();
    const [cancelled] = await tx.update(leaveRequests)
      .set({ status: "CANCELLED", updatedBy: current.id, updatedAt: now })
      .where(and(
        eq(leaveRequests.id, validId),
        eq(leaveRequests.companyId, actor.companyId),
        eq(leaveRequests.status, existing.request.status),
      ))
      .returning();
    if (!cancelled) throw ApiError.conflict("La solicitud cambió; actualiza antes de cancelar.");

    const balanceRows = await tx.select().from(leaveBalances).where(and(
      eq(leaveBalances.userId, cancelled.userId),
      eq(leaveBalances.leaveTypeId, cancelled.leaveTypeId),
      eq(leaveBalances.year, year),
    )).for("update");
    const balance = balanceRows[0];
    if (balance) {
      const currentPending = balance.pending ?? 0;
      const currentUsed = balance.used ?? 0;
      const nextPending = existing.request.status === "PENDING" ? Math.max(0, currentPending - cancelled.totalDays) : currentPending;
      const nextUsed = existing.request.status === "APPROVED" ? Math.max(0, currentUsed - cancelled.totalDays) : currentUsed;
      const nextBalance = balance.totalEntitlement - nextUsed - nextPending;
      await tx.update(leaveBalances).set({
        used: nextUsed,
        pending: nextPending,
        balance: nextBalance,
        updatedAt: now,
      }).where(eq(leaveBalances.id, balance.id));
    }

    if (existing.request.status === "APPROVED" && existing.leaveTypeName === "VACATION") {
      await recordLeaveCancellationEvent(tx, {
        companyId: cancelled.companyId,
        userId: cancelled.userId,
        actorId: current.id,
        leaveRequestId: cancelled.id,
      });
    }

    return serializeVacationDates(cancelled);
  });
}
