import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { vacationHistoryEvents, vacationHistoryStreams } from "@/lib/db/schema";
import { vacationCivilDay } from "@/lib/services/vacation-dates";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function hasVacationHistoryTables(tx: Tx): Promise<boolean> {
  const result = await tx.execute<{ present: boolean }>(
    sql`SELECT (to_regclass('public.vacation_history_streams') IS NOT NULL
      AND to_regclass('public.vacation_history_events') IS NOT NULL) AS present`,
  );
  return Boolean(result.rows[0]?.present);
}

/** Devuelve el stream cabeza (no sustituido) de un empleado dentro de la transacción, o null si aún no tiene apertura verificada. */
export async function findActiveVacationHistoryHead(
  tx: Tx,
  companyId: string,
  userId: string,
): Promise<string | null> {
  if (!(await hasVacationHistoryTables(tx))) return null;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${companyId}:${userId}`}, 0))`);
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT s.id
    FROM public.vacation_history_streams s
    WHERE s.company_id = ${companyId}
      AND s.user_id = ${userId}
      AND NOT EXISTS (
        SELECT 1 FROM public.vacation_history_streams succ
        WHERE succ.predecessor_id = s.id
      )
    LIMIT 1
  `);
  return rows.rows[0]?.id ?? null;
}

export async function recordVacationApprovalEvent(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    actorId: string;
    vacationRequestId: string;
    startDate: Date | string;
    endDate: Date | string;
    totalDays: number;
    reason?: string | null;
  },
) {
  const streamId = await findActiveVacationHistoryHead(tx, input.companyId, input.userId);
  if (!streamId) return null;
  const [event] = await tx.insert(vacationHistoryEvents).values({
    streamId,
    companyId: input.companyId,
    userId: input.userId,
    kind: "APPROVE_REQUEST",
    validFrom: vacationCivilDay(input.startDate),
    validThrough: vacationCivilDay(input.endDate),
    days: input.totalDays,
    vacationRequestId: input.vacationRequestId,
    sourceReference: `vacation_request:${input.vacationRequestId}`,
    reason: input.reason?.trim() || "Aprobación de solicitud de vacaciones",
    actorId: input.actorId,
    idempotencyKey: `vacation-approve:${input.vacationRequestId}`,
  }).returning();
  return event;
}

export async function recordVacationCancellationEvent(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    actorId: string;
    vacationRequestId: string;
    reason?: string | null;
  },
) {
  const streamId = await findActiveVacationHistoryHead(tx, input.companyId, input.userId);
  if (!streamId) return null;
  const [approval] = await tx.select({ id: vacationHistoryEvents.id })
    .from(vacationHistoryEvents)
    .where(and(
      eq(vacationHistoryEvents.streamId, streamId),
      eq(vacationHistoryEvents.companyId, input.companyId),
      eq(vacationHistoryEvents.userId, input.userId),
      eq(vacationHistoryEvents.kind, "APPROVE_REQUEST"),
      eq(vacationHistoryEvents.vacationRequestId, input.vacationRequestId),
    ))
    .limit(1);
  if (!approval) return null;
  const [event] = await tx.insert(vacationHistoryEvents).values({
    streamId,
    companyId: input.companyId,
    userId: input.userId,
    kind: "CANCEL_REQUEST",
    vacationRequestId: input.vacationRequestId,
    reversesEventId: approval.id,
    sourceReference: `vacation_request:${input.vacationRequestId}`,
    reason: input.reason?.trim() || "Cancelación de solicitud de vacaciones",
    actorId: input.actorId,
    idempotencyKey: `vacation-cancel:${input.vacationRequestId}`,
  }).returning();
  return event;
}

export async function recordLeaveApprovalEvent(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    actorId: string;
    leaveRequestId: string;
    startDate: Date | string;
    endDate: Date | string;
    totalDays: number;
    reason?: string | null;
  },
) {
  const streamId = await findActiveVacationHistoryHead(tx, input.companyId, input.userId);
  if (!streamId) return null;
  const [event] = await tx.insert(vacationHistoryEvents).values({
    streamId,
    companyId: input.companyId,
    userId: input.userId,
    kind: "APPROVE_REQUEST",
    validFrom: vacationCivilDay(input.startDate),
    validThrough: vacationCivilDay(input.endDate),
    days: input.totalDays,
    leaveRequestId: input.leaveRequestId,
    sourceReference: `leave_request:${input.leaveRequestId}`,
    reason: input.reason?.trim() || "Aprobación de permiso de vacaciones",
    actorId: input.actorId,
    idempotencyKey: `leave-approve:${input.leaveRequestId}`,
  }).returning();
  return event;
}

export async function recordLeaveCancellationEvent(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    actorId: string;
    leaveRequestId: string;
    reason?: string | null;
  },
) {
  const streamId = await findActiveVacationHistoryHead(tx, input.companyId, input.userId);
  if (!streamId) return null;
  const [approval] = await tx.select({ id: vacationHistoryEvents.id })
    .from(vacationHistoryEvents)
    .where(and(
      eq(vacationHistoryEvents.streamId, streamId),
      eq(vacationHistoryEvents.companyId, input.companyId),
      eq(vacationHistoryEvents.userId, input.userId),
      eq(vacationHistoryEvents.kind, "APPROVE_REQUEST"),
      eq(vacationHistoryEvents.leaveRequestId, input.leaveRequestId),
    ))
    .limit(1);
  if (!approval) return null;
  const [event] = await tx.insert(vacationHistoryEvents).values({
    streamId,
    companyId: input.companyId,
    userId: input.userId,
    kind: "CANCEL_REQUEST",
    leaveRequestId: input.leaveRequestId,
    reversesEventId: approval.id,
    sourceReference: `leave_request:${input.leaveRequestId}`,
    reason: input.reason?.trim() || "Cancelación de permiso de vacaciones",
    actorId: input.actorId,
    idempotencyKey: `leave-cancel:${input.leaveRequestId}`,
  }).returning();
  return event;
}

// Re-export para referencia tipada de tabla
export { vacationHistoryStreams };
