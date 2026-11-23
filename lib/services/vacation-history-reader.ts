import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { vacationHistoryEvents, vacationHistoryStreams } from "@/lib/db/schema";
import { withVacationHistoryTransaction } from "@/lib/db/vacation-runtime";
import { vacationCivilDay, vacationDate } from "@/lib/services/vacation-dates";
import {
  resolveVacationHistory,
  type VacationHistoryCoverage,
  type VacationHistoryGrant,
  type VacationHistoryRequest,
  type VacationHistoryResult,
} from "@/lib/services/vacation-history";

export interface VacationHistoryCutoff {
  knownAt: string;
  throughVersion: string;
}

export interface VacationHistoryManifest extends VacationHistoryCutoff {
  streamId: string | null;
}

export type VacationHistoryReadResult =
  | { status: "OK"; manifest: VacationHistoryManifest; result: VacationHistoryResult }
  | { status: "QUERY_ERROR"; manifest: VacationHistoryManifest | null };

type QueryTx = Pick<typeof db, "select" | "execute">;
type QueryDb = QueryTx & { transaction?: <T>(fn: (tx: QueryTx) => Promise<T>) => Promise<T> };

export interface ReadVacationHistoryInput {
  companyId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  actorId?: string;
  cutoff?: VacationHistoryCutoff;
  dbInstance?: QueryDb;
}

function expandCivilDays(from: string, through: string): string[] {
  const startDay = vacationCivilDay(from);
  const endDay = vacationCivilDay(through);
  const days: string[] = [];
  let cursor = vacationDate(startDay).getTime();
  const limit = vacationDate(endDay).getTime();
  while (cursor <= limit) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return days;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function readInTransaction(
  tx: QueryTx,
  input: Pick<ReadVacationHistoryInput, "companyId" | "userId" | "periodStart" | "periodEnd" | "cutoff">,
): Promise<{ manifest: VacationHistoryManifest; result: VacationHistoryResult }> {
  let knownAt: string;
  let throughVersion: bigint;

  if (input.cutoff) {
    knownAt = input.cutoff.knownAt;
    throughVersion = BigInt(input.cutoff.throughVersion);
  } else {
    // Protocolo de corte consistente: mismo advisory lock que los escritores.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.companyId}:${input.userId}`}, 0))`);
    const snap = (await tx.execute(sql`
      SELECT
        date_trunc('milliseconds', clock_timestamp()) AS known_at,
        greatest(
          coalesce((SELECT max(record_version) FROM public.vacation_history_streams WHERE company_id = ${input.companyId} AND user_id = ${input.userId}), 0),
          coalesce((SELECT max(record_version) FROM public.vacation_history_events WHERE company_id = ${input.companyId} AND user_id = ${input.userId}), 0)
        )::text AS through_version
    `)).rows[0] as { known_at: Date | string; through_version: string };
    knownAt = toIso(snap.known_at);
    throughVersion = BigInt(snap.through_version);
  }

  const streams = await tx.select().from(vacationHistoryStreams)
    .where(and(
      eq(vacationHistoryStreams.companyId, input.companyId),
      eq(vacationHistoryStreams.userId, input.userId),
      lte(vacationHistoryStreams.recordVersion, throughVersion),
    ))
    .orderBy(asc(vacationHistoryStreams.recordVersion), asc(vacationHistoryStreams.id));

  if (streams.length === 0) {
    const manifest: VacationHistoryManifest = { knownAt, throughVersion: throughVersion.toString(), streamId: null };
    return { manifest, result: { status: "MISSING", reason: "NO_COVERAGE" } };
  }

  const supersededIds = new Set<string>(
    streams
      .map((s: typeof vacationHistoryStreams.$inferSelect) => s.predecessorId)
      .filter((id: string | null): id is string => Boolean(id)),
  );
  const activeHeads = streams.filter((s: typeof vacationHistoryStreams.$inferSelect) => !supersededIds.has(s.id));
  const head = activeHeads[activeHeads.length - 1];

  const events = await tx.select().from(vacationHistoryEvents)
    .where(and(
      eq(vacationHistoryEvents.streamId, head.id),
      eq(vacationHistoryEvents.companyId, input.companyId),
      eq(vacationHistoryEvents.userId, input.userId),
      lte(vacationHistoryEvents.recordVersion, throughVersion),
    ))
    .orderBy(asc(vacationHistoryEvents.recordVersion), asc(vacationHistoryEvents.id));

  let coverageThrough = vacationCivilDay(head.coverageThrough);
  const revocationsByGrant = new Map<string, string>();
  const cancellationsByApproval = new Map<string, string>();

  for (const event of events) {
    if (event.kind === "COVERAGE" && event.validThrough) {
      const ext = vacationCivilDay(event.validThrough);
      if (ext > coverageThrough) coverageThrough = ext;
    } else if (event.kind === "REVOKE_GRANT" && event.reversesEventId) {
      revocationsByGrant.set(event.reversesEventId, toIso(event.recordedAt));
    } else if (event.kind === "CANCEL_REQUEST" && event.reversesEventId) {
      cancellationsByApproval.set(event.reversesEventId, toIso(event.recordedAt));
    }
  }

  const coverage: VacationHistoryCoverage = {
    id: head.id,
    companyId: head.companyId,
    userId: head.userId,
    from: vacationCivilDay(head.coverageFrom),
    through: coverageThrough,
    recordedAt: toIso(head.recordedAt),
    sourceReference: head.sourceReference,
  };

  const grants: VacationHistoryGrant[] = [];
  const requests: VacationHistoryRequest[] = [];

  for (const event of events) {
    if (event.kind === "GRANT" && event.validFrom && event.validThrough && event.days !== null) {
      grants.push({
        id: event.id,
        companyId: event.companyId,
        userId: event.userId,
        days: event.days,
        validFrom: vacationCivilDay(event.validFrom),
        validThrough: vacationCivilDay(event.validThrough),
        recordedAt: toIso(event.recordedAt),
        sourceReference: event.sourceReference,
        revocationRecordedAt: revocationsByGrant.get(event.id),
      });
    } else if (event.kind === "APPROVE_REQUEST" && event.validFrom && event.validThrough) {
      const canonicalId = event.vacationRequestId
        ? `vacation:${event.vacationRequestId}`
        : event.leaveRequestId
          ? `leave:${event.leaveRequestId}`
          : event.id;
      requests.push({
        id: canonicalId,
        companyId: event.companyId,
        userId: event.userId,
        days: expandCivilDays(event.validFrom, event.validThrough),
        approvalRecordedAt: toIso(event.recordedAt),
        cancellationRecordedAt: cancellationsByApproval.get(event.id),
      });
    }
  }

  const result = resolveVacationHistory({
    companyId: input.companyId,
    userId: input.userId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    knownAt,
    coverage,
    grants,
    requests,
  });

  return {
    manifest: { knownAt, throughVersion: throughVersion.toString(), streamId: head.id },
    result,
  };
}

/** Lee el historial verificado de vacaciones al corte (knownAt + throughVersion), sin fallback a saldos mutables. */
export async function readVacationHistoryAtCutoff(input: ReadVacationHistoryInput): Promise<VacationHistoryReadResult> {
  try {
    if (input.dbInstance) {
      if (typeof input.dbInstance.transaction === "function") {
        const outcome = await input.dbInstance.transaction(async (tx: QueryTx) => {
          if (input.actorId) {
            await tx.execute(sql`SELECT set_config('app.current_company_id', ${input.companyId}, true), set_config('app.current_actor_id', ${input.actorId}, true)`);
          }
          return readInTransaction(tx, input);
        });
        return { status: "OK", ...outcome };
      }
      const outcome = await readInTransaction(input.dbInstance, input);
      return { status: "OK", ...outcome };
    }

    if (input.actorId) {
      const outcome = await withVacationHistoryTransaction(
        { id: input.actorId, companyId: input.companyId },
        tx => readInTransaction(tx, input),
      );
      return { status: "OK", ...outcome };
    }

    const outcome = await db.transaction(tx => readInTransaction(tx, input));
    return { status: "OK", ...outcome };
  } catch {
    return { status: "QUERY_ERROR", manifest: null };
  }
}
