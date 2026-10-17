import { and, desc, eq, inArray, notInArray, sql, getTableColumns } from "drizzle-orm";

import { db } from "@/lib/db";
import { branches, exceptions, users } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { AuditService } from "./audit-service";
import { emitDomainEvent } from "./domain-event-service";
import {
  transition,
  type ExceptionEvent,
} from "./exception-lifecycle";
import { computeSlaDueAt } from "./exception-sla";
import type {
  ExceptionActionMeta,
  ExceptionDomain,
  ExceptionSeverity,
  ExceptionStatus,
  QsrRiskCategory,
} from "./exception-types";

export type ExceptionRow = typeof exceptions.$inferSelect;

export interface RaiseExceptionInput {
  companyId: string;
  branchId?: string | null;
  domain: ExceptionDomain;
  qsrCategory: QsrRiskCategory;
  severity: ExceptionSeverity;
  subjectType: string;
  subjectId: string;
  reason: string;
  ownerId?: string | null;
  actionMeta?: ExceptionActionMeta | Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  /** Actor humano que origina la excepción (manual). Adapters lo omiten. */
  actorId?: string | null;
}

export interface ListExceptionsOptions {
  branchId?: string | null;
  status?: ExceptionStatus | ExceptionStatus[];
  domain?: ExceptionDomain;
  severity?: ExceptionSeverity;
  qsrCategory?: QsrRiskCategory;
  ownerId?: string | null;
  subjectType?: string;
  limit?: number;
  offset?: number;
}

const OPEN_STATUSES: ExceptionStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_ACTION",
  "RESOLVED",
  "VERIFIED",
  "REOPENED",
  "ESCALATED",
];

function snapshot(row: ExceptionRow, fields: string[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = (row as Record<string, unknown>)[f];
  return out;
}

async function writeAudit(params: {
  row: ExceptionRow;
  action: "CREATE" | "UPDATE";
  actorId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}) {
  // Los adaptadores no tienen actor humano: la fila de dominio origen ya tiene
  // su propia auditoría. Solo se registra la mutación humana.
  if (!params.actorId) return;
  await AuditService.logEmployeeAction({
    userId: params.actorId,
    performedBy: params.actorId,
    action: params.action,
    entityType: "EXCEPTION",
    entityId: params.row.id,
    oldValue: params.before ?? null,
    newValue: params.after ?? null,
    reason: params.reason ?? undefined,
  });
}

function emitRaised(row: ExceptionRow) {
  if (!row.branchId) return;
  void emitDomainEvent({
    companyId: row.companyId,
    branchId: row.branchId,
    eventType: "EXCEPTION_RAISED",
    payload: {
      exceptionId: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      severity: row.severity,
      domain: row.domain,
    },
  }).catch((error) => {
    console.error("[exception-service] EXCEPTION_RAISED emit failed", error);
  });
}

function emitClosed(row: ExceptionRow) {
  if (!row.branchId) return;
  void emitDomainEvent({
    companyId: row.companyId,
    branchId: row.branchId,
    eventType: "EXCEPTION_CLOSED",
    payload: {
      exceptionId: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      severity: row.severity,
    },
  }).catch((error) => {
    console.error("[exception-service] EXCEPTION_CLOSED emit failed", error);
  });
}

/**
 * Owner por defecto: gerente de la sucursal, siempre que sea un usuario activo
 * de la misma empresa. Nunca devuelve un usuario de otra empresa.
 */
async function resolveDefaultOwner(
  companyId: string,
  branchId: string | null | undefined,
): Promise<string | null> {
  if (!branchId) return null;
  const [branch] = await db
    .select({ managerId: branches.managerId })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
    .limit(1);
  const managerId = branch?.managerId;
  if (!managerId) return null;

  const [manager] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, managerId),
        eq(users.companyId, companyId),
        eq(users.active, true),
      ),
    )
    .limit(1);
  return manager?.id ?? null;
}

async function loadScoped(id: string, companyId: string): Promise<ExceptionRow> {
  const [row] = await db
    .select()
    .from(exceptions)
    .where(and(eq(exceptions.id, id), eq(exceptions.companyId, companyId)))
    .limit(1);
  if (!row) {
    // 404 indistinto: no revela si existe en otra empresa.
    throw ApiError.notFound("Excepción no encontrada.");
  }
  return row;
}

/**
 * Aplica un evento de lifecycle a una fila, validando con la máquina de
 * estados. Escribe auditoría humana cuando hay actor.
 */
async function applyEvent(params: {
  id: string;
  companyId: string;
  event: ExceptionEvent;
  actorId: string | null;
  patch: Partial<typeof exceptions.$inferInsert>;
  auditReason?: string | null;
}): Promise<ExceptionRow> {
  const row = await loadScoped(params.id, params.companyId);

  const result = transition(row.status, params.event, {
    actorId: params.actorId ?? undefined,
    ownerId: (params.patch.ownerId as string | undefined) ?? undefined,
    resolution: (params.patch.resolution as string | undefined) ?? undefined,
    resolvedBy: row.resolvedBy ?? undefined,
    reason: params.auditReason ?? undefined,
  });

  if (!result.ok) {
    throw ApiError.conflict(result.reason ?? "Transición ilegal");
  }

  const [updated] = await db
    .update(exceptions)
    .set({ ...params.patch, status: result.to ?? row.status, updatedAt: new Date() })
    .where(and(eq(exceptions.id, row.id), eq(exceptions.companyId, params.companyId)))
    .returning();

  await writeAudit({
    row: updated,
    action: "UPDATE",
    actorId: params.actorId,
    before: snapshot(row, ["status", "ownerId", "resolution", "resolvedBy"]),
    after: snapshot(updated, ["status", "ownerId", "resolution", "resolvedBy"]),
    reason: params.auditReason ?? null,
  });

  if (result.to === "CLOSED") emitClosed(updated);

  return updated;
}

export const ExceptionService = {
  /**
   * Upsert idempotente por `(companyId, subjectType, subjectId)`. Reejecutar un
   * adaptador actualiza severidad/razón sin duplicar ni reiniciar el lifecycle.
   */
  async raise(input: RaiseExceptionInput): Promise<ExceptionRow> {
    if (!input.reason?.trim()) {
      throw ApiError.badRequest("La excepción requiere una razón.");
    }

    const ownerId =
      input.ownerId ?? (await resolveDefaultOwner(input.companyId, input.branchId));
    const slaDueAt = computeSlaDueAt(input.severity);

    const [row] = await db
      .insert(exceptions)
      .values({
        companyId: input.companyId,
        branchId: input.branchId ?? null,
        domain: input.domain,
        qsrCategory: input.qsrCategory,
        severity: input.severity,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        reason: input.reason.trim(),
        ownerId,
        slaDueAt,
        actionMeta: input.actionMeta ?? null,
        metadata: input.metadata ?? null,
      })
      .onConflictDoUpdate({
        target: [
          exceptions.companyId,
          exceptions.subjectType,
          exceptions.subjectId,
        ],
        set: {
          // No se pisan status/owner/resolution/evidencia: el lifecycle manda.
          branchId: input.branchId ?? null,
          domain: input.domain,
          qsrCategory: input.qsrCategory,
          severity: input.severity,
          reason: input.reason.trim(),
          actionMeta: input.actionMeta ?? null,
          metadata: input.metadata ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ ...getTableColumns(exceptions), isNew: sql<boolean>`xmax = 0` });

    if (row.isNew) {
      await writeAudit({
        row,
        action: "CREATE",
        actorId: input.actorId,
        after: snapshot(row, ["status", "severity", "domain", "subjectType", "subjectId"]),
        reason: input.reason,
      });
      emitRaised(row);
    }

    return row;
  },

  async getById(id: string, companyId: string): Promise<ExceptionRow> {
    return loadScoped(id, companyId);
  },

  /** Fila canónica por clave de idempotencia; `null` si no existe. */
  async getBySubject(
    companyId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<ExceptionRow | null> {
    const [row] = await db
      .select()
      .from(exceptions)
      .where(
        and(
          eq(exceptions.companyId, companyId),
          eq(exceptions.subjectType, subjectType),
          eq(exceptions.subjectId, subjectId),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async list(
    companyId: string,
    opts: ListExceptionsOptions = {},
  ): Promise<ExceptionRow[]> {
    const statuses = opts.status
      ? Array.isArray(opts.status)
        ? opts.status
        : [opts.status]
      : undefined;

    return db
      .select()
      .from(exceptions)
      .where(
        and(
          eq(exceptions.companyId, companyId),
          opts.branchId ? eq(exceptions.branchId, opts.branchId) : undefined,
          statuses ? inArray(exceptions.status, statuses) : undefined,
          opts.domain ? eq(exceptions.domain, opts.domain) : undefined,
          opts.severity ? eq(exceptions.severity, opts.severity) : undefined,
          opts.qsrCategory ? eq(exceptions.qsrCategory, opts.qsrCategory) : undefined,
          opts.ownerId ? eq(exceptions.ownerId, opts.ownerId) : undefined,
          opts.subjectType
            ? eq(exceptions.subjectType, opts.subjectType)
            : undefined,
        ),
      )
      .orderBy(desc(exceptions.slaDueAt), desc(exceptions.createdAt))
      .limit(opts.limit ?? 200)
      .offset(opts.offset ?? 0);
  },

  /** Excepciones no terminales (feed de control), opcionalmente por sucursal. */
  async listOpen(
    companyId: string,
    opts: { branchId?: string | null; limit?: number } = {},
  ): Promise<ExceptionRow[]> {
    return db
      .select()
      .from(exceptions)
      .where(
        and(
          eq(exceptions.companyId, companyId),
          notInArray(exceptions.status, ["CLOSED", "CANCELLED"]),
          opts.branchId ? eq(exceptions.branchId, opts.branchId) : undefined,
        ),
      )
      .orderBy(desc(exceptions.slaDueAt), desc(exceptions.createdAt))
      .limit(opts.limit ?? 200);
  },

  async assign(
    id: string,
    companyId: string,
    ownerId: string,
    actorId: string | null,
  ): Promise<ExceptionRow> {
    return applyEvent({
      id,
      companyId,
      actorId,
      event: "ASSIGN",
      patch: { ownerId },
    });
  },

  async startAction(
    id: string,
    companyId: string,
    actorId: string | null,
  ): Promise<ExceptionRow> {
    return applyEvent({ id, companyId, actorId, event: "START_ACTION", patch: {} });
  },

  async resolve(
    id: string,
    companyId: string,
    actorId: string | null,
    resolution: string,
  ): Promise<ExceptionRow> {
    return applyEvent({
      id,
      companyId,
      actorId,
      event: "RESOLVE",
      patch: {
        resolution,
        resolvedBy: actorId,
        resolvedAt: new Date(),
      },
    });
  },

  async verify(
    id: string,
    companyId: string,
    actorId: string,
  ): Promise<ExceptionRow> {
    return applyEvent({
      id,
      companyId,
      actorId,
      event: "VERIFY",
      patch: { verifiedBy: actorId, verifiedAt: new Date() },
    });
  },

  async close(
    id: string,
    companyId: string,
    actorId: string | null,
  ): Promise<ExceptionRow> {
    return applyEvent({
      id,
      companyId,
      actorId,
      event: "CLOSE",
      patch: { closedAt: new Date() },
    });
  },

  async reopen(
    id: string,
    companyId: string,
    actorId: string | null,
    reason: string,
  ): Promise<ExceptionRow> {
    const row = await loadScoped(id, companyId);
    return applyEvent({
      id,
      companyId,
      actorId,
      event: "REOPEN",
      patch: { reopenedFromId: row.reopenedFromId ?? row.id },
      auditReason: reason,
    });
  },

  async escalate(
    id: string,
    companyId: string,
    actorId: string | null,
    reason?: string,
  ): Promise<ExceptionRow> {
    const row = await loadScoped(id, companyId);
    // Al escalar se recalcula el SLA si aún no había uno.
    return applyEvent({
      id,
      companyId,
      actorId,
      event: "ESCALATE",
      patch: row.slaDueAt
        ? {}
        : { slaDueAt: computeSlaDueAt(row.severity) },
      auditReason: reason,
    });
  },

  async cancel(
    id: string,
    companyId: string,
    actorId: string | null,
    reason?: string,
  ): Promise<ExceptionRow> {
    return applyEvent({
      id,
      companyId,
      actorId,
      event: "CANCEL",
      patch: {},
      auditReason: reason,
    });
  },
};

export { OPEN_STATUSES };
