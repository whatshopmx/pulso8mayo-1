/**
 * EXC-04.presupuesto — Servicio de persistencia y cierre auditado para
 * excepciones canónicas de gasto fuera de presupuesto (`budget_overrun`).
 *
 * Garantías:
 * 1. Conserva la instantánea de la regla presupuestal (`ruleSnapshot`) y el
 *    responsable (`ownerId`) al detectar un gasto fuera de presupuesto.
 * 2. Repetir la detección o ejecutar el adaptador nunca duplica la excepción
 *    ni reabre una excepción ya terminada (`CLOSED` / `CANCELLED`).
 * 3. Autorizar o rechazar el gasto fuera de presupuesto audita la decisión
 *    (`AUD-02` `APPROVAL_EXPENSE`) y cierra la excepción canónica con auditoría
 *    (`EXCEPTION`) dentro de la MISMA transacción: si la auditoría falla, todo
 *    revierte sin estados parciales.
 */
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { branches, costCenters, exceptions, users } from "@/lib/db/schema";
import { AuditService } from "./audit-service";
import { isTerminal } from "./exception-lifecycle";
import {
  ExceptionService,
  type DbExecutor,
  type ExceptionRow,
} from "./exception-service";
import {
  BUDGET_OVERRUN_SUBJECT_TYPE,
  buildBudgetExceptionClosureReason,
  buildBudgetOverrunExceptionInput,
  resolveBudgetExceptionOwnerId,
  type BudgetExceptionClosureRecord,
  type OverbudgetRuleEvaluation,
} from "./budget-exception-rules";

export interface RaiseBudgetOverrunResult {
  exception: ExceptionRow;
  created: boolean;
  preservedTerminal: boolean;
}

/**
 * Resuelve el responsable (`ownerId`) dentro de la misma empresa y transacción,
 * priorizando autoridad >= `requiredRole` distinta del solicitante.
 */
export async function resolveBudgetOwnerInDb(
  params: {
    companyId: string;
    branchId: string;
    requiredRole: string;
    requestedBy: string;
  },
  executor: DbExecutor = db,
): Promise<string | null> {
  const [[branch], companyUsers] = await Promise.all([
    executor
      .select({ managerId: branches.managerId })
      .from(branches)
      .where(
        and(
          eq(branches.id, params.branchId),
          eq(branches.companyId, params.companyId),
        ),
      )
      .limit(1),
    executor
      .select({
        id: users.id,
        role: users.role,
        branchId: users.branchId,
        active: users.active,
      })
      .from(users)
      .where(
        and(
          eq(users.companyId, params.companyId),
          eq(users.active, true),
          isNull(users.deletedAt),
        ),
      ),
  ]);

  return resolveBudgetExceptionOwnerId(companyUsers, {
    branchId: params.branchId,
    branchManagerId: branch?.managerId ?? null,
    requiredRole: params.requiredRole,
    requestedBy: params.requestedBy,
  });
}

/**
 * Registra o sincroniza de forma idempotente la excepción canónica de
 * sobre-presupuesto para un gasto operativo.
 *
 * - Si ya existe una excepción terminal (`CLOSED`/`CANCELLED`), la conserva
 *   sin duplicarla ni reabrirla.
 * - Si ya existe una excepción abierta, preserva su `ownerId`, `status` y
 *   `metadata.ruleSnapshot` originales.
 */
export async function raiseBudgetOverrunException(
  params: {
    companyId: string;
    branchId: string;
    expenseId: string;
    category: string;
    description: string;
    amountCents: number;
    requestedBy: string;
    sourceStatus: string;
    evaluation: OverbudgetRuleEvaluation;
    costCenterId?: string | null;
    actorId?: string | null;
  },
  executor: DbExecutor = db,
): Promise<RaiseBudgetOverrunResult> {
  const existing = await ExceptionService.getBySubject(
    params.companyId,
    BUDGET_OVERRUN_SUBJECT_TYPE,
    params.expenseId,
    executor,
  );

  if (existing && isTerminal(existing.status)) {
    return { exception: existing, created: false, preservedTerminal: true };
  }

  let evaluation = params.evaluation;
  if (
    evaluation.ruleSnapshot &&
    (!evaluation.ruleSnapshot.costCenterCode || !evaluation.ruleSnapshot.costCenterName) &&
    (params.costCenterId ?? evaluation.ruleSnapshot.costCenterId)
  ) {
    const ccId = params.costCenterId ?? evaluation.ruleSnapshot.costCenterId;
    const [cc] = await executor
      .select({ code: costCenters.code, name: costCenters.name })
      .from(costCenters)
      .where(and(eq(costCenters.id, ccId), eq(costCenters.companyId, params.companyId)))
      .limit(1);
    if (cc) {
      evaluation = {
        ...evaluation,
        ruleSnapshot: {
          ...evaluation.ruleSnapshot,
          costCenterCode: cc.code,
          costCenterName: cc.name,
        },
      };
    }
  }

  const ownerId =
    existing?.ownerId ??
    (await resolveBudgetOwnerInDb(
      {
        companyId: params.companyId,
        branchId: params.branchId,
        requiredRole: evaluation.requiredApproverRole,
        requestedBy: params.requestedBy,
      },
      executor,
    ));

  const existingMetadata =
    existing && typeof existing.metadata === "object" && existing.metadata !== null
      ? (existing.metadata as Record<string, unknown>)
      : null;

  const raiseInput = buildBudgetOverrunExceptionInput({
    companyId: params.companyId,
    branchId: params.branchId,
    expenseId: params.expenseId,
    category: params.category,
    description: params.description,
    amountCents: params.amountCents,
    requestedBy: params.requestedBy,
    sourceStatus: params.sourceStatus,
    evaluation,
    ownerId,
    actorId: existing ? null : (params.actorId ?? null),
    existingMetadata,
    existingOwnerId: existing?.ownerId ?? null,
  });

  const row = await ExceptionService.raise(raiseInput, executor);
  return {
    exception: row,
    created: !existing,
    preservedTerminal: false,
  };
}

/**
 * Cierra y audita atómicamente (dentro de la transacción activa `executor`) la
 * autorización o rechazo de un gasto fuera de presupuesto y su excepción
 * canónica asociada.
 *
 * - Si la excepción está en `VERIFIED`, cierra con `CLOSE` (`CLOSED`).
 * - Si está en `RESOLVED` por otro actor, verifica (`VERIFY`) y cierra (`CLOSE`).
 * - Si está en otro estado no terminal (`OPEN`, `ASSIGNED`, `IN_ACTION`,
 *   `REOPENED`, `ESCALATED` o `RESOLVED` por el mismo actor), cierra vía
 *   `CANCEL` (`CANCELLED`) con `actorId` autenticado y razón `AUD-02`,
 *   conservando intactos `ownerId` y `metadata.ruleSnapshot`.
 * - Siempre escribe auditoría crítica `AUD-02` (`APPROVAL_EXPENSE`) en la misma
 *   transacción: cualquier fallo revierte tanto el gasto como la excepción.
 */
export async function closeBudgetOverrunExceptionInTx(params: {
  companyId: string;
  expenseId: string;
  decision: "APPROVED" | "REJECTED";
  actorId: string;
  actorRole: string;
  notes?: string | null;
  expenseBefore: {
    status: string;
    amountCents: number;
    costCenterId: string | null;
    requestedBy: string;
  };
  expenseAfter: {
    status: string;
    approvedBy: string | null;
    overbudgetApprovedBy: string | null;
    overbudgetApprovedAt: Date | null;
    approvalNotes: string | null;
  };
  executor: DbExecutor;
}): Promise<{
  exception: ExceptionRow | null;
  closureReason: string;
}> {
  const { companyId, expenseId, decision, actorId, actorRole, executor } = params;
  const closureReason = buildBudgetExceptionClosureReason({
    decision,
    approverRole: actorRole,
    notes: params.notes,
    expenseId,
  });

  const existing = await ExceptionService.getBySubject(
    companyId,
    BUDGET_OVERRUN_SUBJECT_TYPE,
    expenseId,
    executor,
  );

  let finalException: ExceptionRow | null = existing;

  if (existing && !isTerminal(existing.status)) {
    const closureRecord: BudgetExceptionClosureRecord = {
      decision,
      actorId,
      actorRole,
      reason: closureReason,
      closedAt: new Date().toISOString(),
    };

    const existingMeta =
      typeof existing.metadata === "object" && existing.metadata !== null
        ? (existing.metadata as Record<string, unknown>)
        : {};

    // Conservar ruleSnapshot y ownerId originales, anexando la decisión de cierre.
    await executor
      .update(exceptions)
      .set({
        metadata: {
          ...existingMeta,
          sourceStatus: params.expenseAfter.status,
          closure: closureRecord,
        },
        updatedAt: new Date(),
      })
      .where(
        and(eq(exceptions.id, existing.id), eq(exceptions.companyId, companyId)),
      );

    if (existing.status === "VERIFIED") {
      finalException = await ExceptionService.close(
        existing.id,
        companyId,
        actorId,
        executor,
        { expectedStatus: "VERIFIED" },
      );
    } else if (
      existing.status === "RESOLVED" &&
      existing.resolvedBy &&
      existing.resolvedBy !== actorId
    ) {
      await ExceptionService.verify(
        existing.id,
        companyId,
        actorId,
        executor,
        { expectedStatus: "RESOLVED" },
      );
      finalException = await ExceptionService.close(
        existing.id,
        companyId,
        actorId,
        executor,
        { expectedStatus: "VERIFIED" },
      );
    } else {
      finalException = await ExceptionService.cancel(
        existing.id,
        companyId,
        actorId,
        closureReason,
        executor,
        { expectedStatus: existing.status },
      );
    }
  }

  const ruleSnapshot =
    existing &&
    typeof existing.metadata === "object" &&
    existing.metadata !== null &&
    "ruleSnapshot" in existing.metadata
      ? (existing.metadata as Record<string, unknown>).ruleSnapshot
      : null;

  await AuditService.logCriticalEmployeeAction(
    {
      userId: actorId,
      performedBy: actorId,
      action: "UPDATE",
      entityType: "APPROVAL_EXPENSE",
      entityId: expenseId,
      oldValue: {
        status: params.expenseBefore.status,
        amountCents: params.expenseBefore.amountCents,
        costCenterId: params.expenseBefore.costCenterId,
        requestedBy: params.expenseBefore.requestedBy,
        ruleSnapshot,
      },
      newValue: {
        status: params.expenseAfter.status,
        decision,
        approvedBy: params.expenseAfter.approvedBy,
        approverRole: actorRole,
        overbudgetApprovedBy: params.expenseAfter.overbudgetApprovedBy,
        overbudgetApprovedAt: params.expenseAfter.overbudgetApprovedAt,
        approvalNotes: params.expenseAfter.approvalNotes,
        exceptionId: finalException?.id ?? null,
        exceptionStatus: finalException?.status ?? null,
        exceptionOwnerId: finalException?.ownerId ?? null,
      },
      reason: closureReason,
      isCritical: true,
    },
    executor,
  );

  return { exception: finalException, closureReason };
}
