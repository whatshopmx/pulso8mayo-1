import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api/error";
import { db } from "@/lib/db";
import { branches, users, vacationHistoryEvents, vacationHistoryStreams } from "@/lib/db/schema";
import { withVacationHistoryTransaction } from "@/lib/db/vacation-runtime";
import { hasPermission, type Role } from "@/lib/permissions";
import { resolveResourceScope, targetInScope } from "@/lib/rbac/resource-scope";
import { vacationCivilDay } from "@/lib/services/vacation-dates";

export interface VacationHistoryActor {
  userId: string;
  companyId: string;
}

const civilDate = z.iso.date().refine(value => value === vacationCivilDay(value), "Fecha civil inválida");
const sourceReference = z.string().trim().min(1).max(1000);
const reason = z.string().trim().min(4).max(2000);
const idempotencyKey = z.string().trim().min(1).max(128);
const targetUserId = z.string().trim().min(1).max(255);

const openStreamBase = z.object({
  operation: z.literal("OPEN_STREAM").optional(),
  userId: targetUserId,
  coverageFrom: civilDate,
  coverageThrough: civilDate,
  predecessorId: z.string().uuid().optional(),
  sourceReference,
  reason,
  idempotencyKey,
}).strict();

const extendCoverageBase = z.object({
  operation: z.literal("EXTEND_COVERAGE").optional(),
  streamId: z.string().uuid(),
  validFrom: civilDate,
  validThrough: civilDate,
  sourceReference,
  reason,
  idempotencyKey,
}).strict();

const grantDaysBase = z.object({
  operation: z.literal("GRANT").optional(),
  streamId: z.string().uuid(),
  days: z.number().int().min(0).max(2147483647),
  validFrom: civilDate,
  validThrough: civilDate,
  sourceReference,
  reason,
  idempotencyKey,
}).strict();

const revokeGrantBase = z.object({
  operation: z.literal("REVOKE_GRANT").optional(),
  streamId: z.string().uuid(),
  reversesEventId: z.string().uuid(),
  sourceReference,
  reason,
  idempotencyKey,
}).strict();

export const openVacationHistoryStreamSchema = openStreamBase.refine(
  value => value.coverageFrom <= value.coverageThrough,
  { message: "La fecha inicial de cobertura debe ser anterior o igual a la fecha final." },
);

export const extendVacationHistoryCoverageSchema = extendCoverageBase.refine(
  value => value.validFrom <= value.validThrough,
  { message: "La vigencia de cobertura es inválida." },
);

export const grantVacationHistoryDaysSchema = grantDaysBase.refine(
  value => value.validFrom <= value.validThrough,
  { message: "La vigencia del crédito es inválida." },
);

export const revokeVacationHistoryGrantSchema = revokeGrantBase;

export const vacationHistoryMutationSchema = z.discriminatedUnion("operation", [
  openStreamBase.extend({ operation: z.literal("OPEN_STREAM") }).refine(
    value => value.coverageFrom <= value.coverageThrough,
    { message: "La fecha inicial de cobertura debe ser anterior o igual a la fecha final." },
  ),
  extendCoverageBase.extend({ operation: z.literal("EXTEND_COVERAGE") }).refine(
    value => value.validFrom <= value.validThrough,
    { message: "La vigencia de cobertura es inválida." },
  ),
  grantDaysBase.extend({ operation: z.literal("GRANT") }).refine(
    value => value.validFrom <= value.validThrough,
    { message: "La vigencia del crédito es inválida." },
  ),
  revokeGrantBase.extend({ operation: z.literal("REVOKE_GRANT") }),
]);

export const vacationHistoryQuerySchema = z.object({
  userId: targetUserId.optional(),
}).strict();

export interface SerializedVacationHistoryStream {
  id: string;
  companyId: string;
  userId: string;
  predecessorId: string | null;
  coverageFrom: string;
  coverageThrough: string;
  sourceReference: string;
  reason: string;
  actorId: string;
  idempotencyKey: string;
  recordedAt: string;
  recordVersion: string;
}

export interface SerializedVacationHistoryEvent {
  id: string;
  streamId: string;
  companyId: string;
  userId: string;
  kind: string;
  validFrom: string | null;
  validThrough: string | null;
  days: number | null;
  vacationRequestId: string | null;
  leaveRequestId: string | null;
  reversesEventId: string | null;
  sourceReference: string;
  reason: string;
  actorId: string;
  idempotencyKey: string;
  recordedAt: string;
  recordVersion: string;
}

function serializeStream(row: typeof vacationHistoryStreams.$inferSelect): SerializedVacationHistoryStream {
  return {
    id: row.id,
    companyId: row.companyId,
    userId: row.userId,
    predecessorId: row.predecessorId ?? null,
    coverageFrom: vacationCivilDay(row.coverageFrom),
    coverageThrough: vacationCivilDay(row.coverageThrough),
    sourceReference: row.sourceReference,
    reason: row.reason,
    actorId: row.actorId,
    idempotencyKey: row.idempotencyKey,
    recordedAt: row.recordedAt instanceof Date ? row.recordedAt.toISOString() : new Date(row.recordedAt).toISOString(),
    recordVersion: String(row.recordVersion),
  };
}

function serializeEvent(row: typeof vacationHistoryEvents.$inferSelect): SerializedVacationHistoryEvent {
  return {
    id: row.id,
    streamId: row.streamId,
    companyId: row.companyId,
    userId: row.userId,
    kind: row.kind,
    validFrom: row.validFrom ? vacationCivilDay(row.validFrom) : null,
    validThrough: row.validThrough ? vacationCivilDay(row.validThrough) : null,
    days: row.days ?? null,
    vacationRequestId: row.vacationRequestId ?? null,
    leaveRequestId: row.leaveRequestId ?? null,
    reversesEventId: row.reversesEventId ?? null,
    sourceReference: row.sourceReference,
    reason: row.reason,
    actorId: row.actorId,
    idempotencyKey: row.idempotencyKey,
    recordedAt: row.recordedAt instanceof Date ? row.recordedAt.toISOString() : new Date(row.recordedAt).toISOString(),
    recordVersion: String(row.recordVersion),
  };
}

/** Relee actor vigente desde el catálogo (nunca confía en el rol de sesión). */
async function loadLiveActor(actor: VacationHistoryActor) {
  const [row] = await db.select({
    id: users.id,
    role: users.role,
    companyId: users.companyId,
    branchId: users.branchId,
  }).from(users).where(and(
    eq(users.id, actor.userId),
    eq(users.companyId, actor.companyId),
    isNull(users.deletedAt),
  ));
  if (!row) throw ApiError.forbidden("La cuenta ya no tiene acceso a esta empresa.");
  return row;
}

async function requireAdminActorAndTarget(actor: VacationHistoryActor, subjectUserId: string) {
  const current = await loadLiveActor(actor);
  if (!hasPermission(current.role as Role, "payroll", "manage")) {
    throw ApiError.forbidden("Se requiere capacidad administrativa de nómina para gestionar el historial de vacaciones.");
  }
  const [target] = await db.select({ id: users.id, companyId: users.companyId, branchId: users.branchId })
    .from(users)
    .where(and(eq(users.id, subjectUserId), eq(users.companyId, actor.companyId), isNull(users.deletedAt)));
  if (!target) throw ApiError.notFound("No se encontró el colaborador en la empresa.");
  return { current, target };
}

async function requireAdminActor(actor: VacationHistoryActor) {
  const current = await loadLiveActor(actor);
  if (!hasPermission(current.role as Role, "payroll", "manage")) {
    throw ApiError.forbidden("Se requiere capacidad administrativa de nómina para gestionar el historial de vacaciones.");
  }
  return current;
}

async function lockEmployeeHistory(tx: Parameters<Parameters<typeof withVacationHistoryTransaction>[1]>[0], companyId: string, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${companyId}:${userId}`}, 0))`);
}

export async function getVacationHistory(actor: VacationHistoryActor, rawQuery: z.infer<typeof vacationHistoryQuerySchema>) {
  const query = vacationHistoryQuerySchema.parse(rawQuery);
  const current = await loadLiveActor(actor);
  const catalog = await db.select({ id: branches.id, companyId: branches.companyId })
    .from(branches).where(eq(branches.companyId, actor.companyId));
  const scope = resolveResourceScope(
    { userId: current.id, role: current.role as Role, companyId: current.companyId, branchId: current.branchId },
    "users",
    "read",
    catalog,
  );
  if (scope.kind === "NONE") throw ApiError.forbidden("No hay un alcance autorizado para consultar el historial.");
  const subjectId = query.userId ?? actor.userId;
  const [target] = await db.select({ userId: users.id, companyId: users.companyId, branchId: users.branchId })
    .from(users).where(and(eq(users.id, subjectId), eq(users.companyId, actor.companyId), isNull(users.deletedAt)));
  if (!target || !targetInScope(scope, target)) {
    throw ApiError.notFound("No se encontró el colaborador.");
  }

  return withVacationHistoryTransaction(
    { id: current.id, companyId: current.companyId, branchId: current.branchId, role: current.role },
    async tx => {
      const streams = await tx.select().from(vacationHistoryStreams)
        .where(and(eq(vacationHistoryStreams.companyId, actor.companyId), eq(vacationHistoryStreams.userId, subjectId)))
        .orderBy(asc(vacationHistoryStreams.recordVersion), asc(vacationHistoryStreams.id));
      const events = await tx.select().from(vacationHistoryEvents)
        .where(and(eq(vacationHistoryEvents.companyId, actor.companyId), eq(vacationHistoryEvents.userId, subjectId)))
        .orderBy(asc(vacationHistoryEvents.recordVersion), asc(vacationHistoryEvents.id));
      return {
        userId: subjectId,
        streams: streams.map(serializeStream),
        events: events.map(serializeEvent),
      };
    },
  );
}

export async function openVacationHistoryStream(
  actor: VacationHistoryActor,
  rawInput: z.infer<typeof openVacationHistoryStreamSchema>,
) {
  const input = openVacationHistoryStreamSchema.parse(rawInput);
  const { current } = await requireAdminActorAndTarget(actor, input.userId);
  return withVacationHistoryTransaction(
    { id: current.id, companyId: current.companyId, branchId: current.branchId, role: current.role },
    async tx => {
      await lockEmployeeHistory(tx, actor.companyId, input.userId);
      const [existing] = await tx.select().from(vacationHistoryStreams).where(and(
        eq(vacationHistoryStreams.companyId, actor.companyId),
        eq(vacationHistoryStreams.userId, input.userId),
        eq(vacationHistoryStreams.idempotencyKey, input.idempotencyKey),
      ));
      if (existing) {
        const matches = vacationCivilDay(existing.coverageFrom) === input.coverageFrom
          && vacationCivilDay(existing.coverageThrough) === input.coverageThrough
          && (existing.predecessorId ?? undefined) === input.predecessorId
          && existing.sourceReference === input.sourceReference
          && existing.reason === input.reason;
        if (!matches) {
          throw ApiError.conflict("La clave de idempotencia ya fue utilizada con otros parámetros de apertura.");
        }
        return { stream: serializeStream(existing), created: false };
      }

      const [saved] = await tx.insert(vacationHistoryStreams).values({
        companyId: actor.companyId,
        userId: input.userId,
        predecessorId: input.predecessorId ?? null,
        coverageFrom: input.coverageFrom,
        coverageThrough: input.coverageThrough,
        sourceReference: input.sourceReference,
        reason: input.reason,
        actorId: current.id,
        idempotencyKey: input.idempotencyKey,
      }).returning();
      return { stream: serializeStream(saved), created: true };
    },
  );
}

async function appendAdminEvent(
  actor: VacationHistoryActor,
  streamId: string,
  payload: {
    kind: "COVERAGE" | "GRANT" | "REVOKE_GRANT";
    validFrom: string | null;
    validThrough: string | null;
    days: number | null;
    reversesEventId: string | null;
    sourceReference: string;
    reason: string;
    idempotencyKey: string;
  },
) {
  const current = await requireAdminActor(actor);
  return withVacationHistoryTransaction(
    { id: current.id, companyId: current.companyId, branchId: current.branchId, role: current.role },
    async tx => {
      const [stream] = await tx.select({
        id: vacationHistoryStreams.id,
        companyId: vacationHistoryStreams.companyId,
        userId: vacationHistoryStreams.userId,
      }).from(vacationHistoryStreams).where(and(
        eq(vacationHistoryStreams.id, streamId),
        eq(vacationHistoryStreams.companyId, actor.companyId),
      ));
      if (!stream) throw ApiError.notFound("No se encontró el historial de vacaciones indicado.");

      await lockEmployeeHistory(tx, stream.companyId, stream.userId);
      const [existing] = await tx.select().from(vacationHistoryEvents).where(and(
        eq(vacationHistoryEvents.streamId, stream.id),
        eq(vacationHistoryEvents.idempotencyKey, payload.idempotencyKey),
      ));
      if (existing) {
        const matches = existing.kind === payload.kind
          && (existing.validFrom ? vacationCivilDay(existing.validFrom) : null) === payload.validFrom
          && (existing.validThrough ? vacationCivilDay(existing.validThrough) : null) === payload.validThrough
          && (existing.days ?? null) === payload.days
          && (existing.reversesEventId ?? null) === payload.reversesEventId
          && existing.sourceReference === payload.sourceReference
          && existing.reason === payload.reason;
        if (!matches) {
          throw ApiError.conflict("La clave de idempotencia ya fue utilizada con otros parámetros del evento.");
        }
        return { event: serializeEvent(existing), created: false };
      }

      const [saved] = await tx.insert(vacationHistoryEvents).values({
        streamId: stream.id,
        companyId: stream.companyId,
        userId: stream.userId,
        kind: payload.kind,
        validFrom: payload.validFrom,
        validThrough: payload.validThrough,
        days: payload.days,
        reversesEventId: payload.reversesEventId,
        sourceReference: payload.sourceReference,
        reason: payload.reason,
        actorId: current.id,
        idempotencyKey: payload.idempotencyKey,
      }).returning();
      return { event: serializeEvent(saved), created: true };
    },
  );
}

export async function extendVacationHistoryCoverage(
  actor: VacationHistoryActor,
  rawInput: z.infer<typeof extendVacationHistoryCoverageSchema>,
) {
  const input = extendVacationHistoryCoverageSchema.parse(rawInput);
  return appendAdminEvent(actor, input.streamId, {
    kind: "COVERAGE",
    validFrom: input.validFrom,
    validThrough: input.validThrough,
    days: null,
    reversesEventId: null,
    sourceReference: input.sourceReference,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function grantVacationHistoryDays(
  actor: VacationHistoryActor,
  rawInput: z.infer<typeof grantVacationHistoryDaysSchema>,
) {
  const input = grantVacationHistoryDaysSchema.parse(rawInput);
  return appendAdminEvent(actor, input.streamId, {
    kind: "GRANT",
    validFrom: input.validFrom,
    validThrough: input.validThrough,
    days: input.days,
    reversesEventId: null,
    sourceReference: input.sourceReference,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function revokeVacationHistoryGrant(
  actor: VacationHistoryActor,
  rawInput: z.infer<typeof revokeVacationHistoryGrantSchema>,
) {
  const input = revokeVacationHistoryGrantSchema.parse(rawInput);
  return appendAdminEvent(actor, input.streamId, {
    kind: "REVOKE_GRANT",
    validFrom: null,
    validThrough: null,
    days: null,
    reversesEventId: input.reversesEventId,
    sourceReference: input.sourceReference,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
  });
}
