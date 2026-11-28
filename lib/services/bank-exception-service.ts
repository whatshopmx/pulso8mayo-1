/**
 * EXC-04.banco — Servicio canónico para detección y resolución trazable de
 * excepciones bancarias (`bank_reconciliation`).
 *
 * Garantías:
 * 1. Conserva fuente original (`sourceSnapshot`), fecha valor (`valueDate`),
 *    antigüedad (`ageDays`), fecha de primera detección (`firstDetectedAt`) y
 *    responsable (`ownerId`).
 * 2. Sincronizar o detectar repetidamente NO duplica excepciones ni borra una
 *    diferencia previamente registrada.
 * 3. Al conciliar (`confirmMatch` / `confirmDepositMatch` / `RESOLVE_WITH_TRACE`):
 *    - Si `differenceCents === 0`, cierra la excepción canónica con
 *      `reconciliationTrace` completo y auditoría crítica `AUD-02`.
 *    - Si `differenceCents !== 0` sin disposición explícita + motivo (>=4 chars),
 *      rechaza ocultar la diferencia (`409 Conflict` en cierre manual) y mantiene
 *      la excepción abierta con `differenceCents` visible.
 *    - Si `differenceCents !== 0` con disposición explícita + motivo, conserva
 *      `differenceCents` + `disposition` tanto en `reconciliationTrace` como en
 *      la bitácora `AUD-02` dentro de la misma transacción.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  bankTransactions,
  exceptions,
  gatewayTransactions,
  paymentRunItems,
  paymentRuns,
  users,
} from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { AuditService } from "./audit-service";
import { isTerminal } from "./exception-lifecycle";
import {
  ExceptionService,
  type DbExecutor,
  type ExceptionRow,
} from "./exception-service";
import {
  BANK_EXCEPTION_SUBJECT_TYPE,
  DEFAULT_BANK_PENDING_THRESHOLD_DAYS,
  buildBankExceptionInput,
  buildBankSubjectId,
  computeBankAgingDays,
  evaluateReconciliationDifferencePolicy,
  resolveBankExceptionOwnerId,
  type BankDifferenceDisposition,
  type BankDiscrepancyCode,
  type BankExceptionSourceKind,
  type BankReconciliationTrace,
  type BankSourceSnapshot,
} from "./bank-exception-rules";

export interface BankExceptionSyncSummary {
  raised: number;
  autoClosedExact: number;
  keptOpenWithDifference: number;
  evaluatedAt: string;
}

export async function resolveBankOwnerInDb(
  companyId: string,
  executor: DbExecutor = db,
): Promise<string | null> {
  const companyUsers = await executor
    .select({
      id: users.id,
      role: users.role,
      active: users.active,
    })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        eq(users.active, true),
        isNull(users.deletedAt),
      ),
    );
  return resolveBankExceptionOwnerId(companyUsers);
}

/**
 * Registra o actualiza idempotente una excepción bancaria conservando fuente,
 * antigüedad, responsable y cualquier diferencia detectada.
 */
export async function recordBankDiscrepancyException(
  params: {
    companyId: string;
    branchId?: string | null;
    source: BankSourceSnapshot;
    actorId?: string | null;
    now?: Date;
  },
  executor: DbExecutor = db,
): Promise<{ exception: ExceptionRow; created: boolean }> {
  const now = params.now ?? new Date();
  const subjectId = buildBankSubjectId(params.source.sourceKind, params.source.sourceId);

  const existing = await ExceptionService.getBySubject(
    params.companyId,
    BANK_EXCEPTION_SUBJECT_TYPE,
    subjectId,
    executor,
  );

  if (existing && isTerminal(existing.status)) {
    return { exception: existing, created: false };
  }

  const ownerId =
    existing?.ownerId ?? (await resolveBankOwnerInDb(params.companyId, executor));

  const existingMeta =
    existing && typeof existing.metadata === "object" && existing.metadata !== null
      ? (existing.metadata as Record<string, unknown>)
      : null;

  const raiseInput = buildBankExceptionInput({
    companyId: params.companyId,
    branchId: params.branchId ?? null,
    source: params.source,
    now,
    ownerId,
    actorId: existing ? null : (params.actorId ?? null),
    existingMetadata: existingMeta,
    existingOwnerId: existing?.ownerId ?? null,
  });

  const row = await ExceptionService.raise(raiseInput, executor);
  return { exception: row, created: !existing };
}

/**
 * Resuelve/cierra una excepción bancaria al conciliar o aplicar disposición
 * explícita dentro de una transacción con auditoría `AUD-02`.
 *
 * - Si hay diferencia (`differenceCents !== 0`) sin disposición explícita y
 *   motivo >= 4 caracteres, lanza `409 Conflict` y deja/actualiza la excepción
 *   abierta con la diferencia visible (nunca la oculta).
 */
export async function resolveBankExceptionOnReconciliation(
  params: {
    companyId: string;
    sourceKind: BankExceptionSourceKind;
    sourceId: string;
    matchedTargetType: BankReconciliationTrace["matchedTargetType"];
    matchedTargetId: string | null;
    bankAmountCents: number;
    targetAmountCents: number;
    actorId: string;
    notes?: string | null;
    disposition?: BankDifferenceDisposition | null;
    now?: Date;
    /** Si true, solo cierra si ya existe una excepción abierta; no crea una nueva en match exacto. */
    onlyIfExisting?: boolean;
  },
  executor?: DbExecutor,
): Promise<{
  closed: boolean;
  differenceCents: number;
  exception: ExceptionRow | null;
  trace: BankReconciliationTrace | null;
}> {
  const now = params.now ?? new Date();
  const subjectId = buildBankSubjectId(params.sourceKind, params.sourceId);

  const run = async (tx: DbExecutor) => {
    const existing = await ExceptionService.getBySubject(
      params.companyId,
      BANK_EXCEPTION_SUBJECT_TYPE,
      subjectId,
      tx,
    );

    if (!existing && params.onlyIfExisting) {
      const diff = Math.abs(params.bankAmountCents) - Math.abs(params.targetAmountCents);
      return { closed: false, differenceCents: diff, exception: null, trace: null };
    }

    if (!existing) {
      throw ApiError.notFound("Excepción bancaria no encontrada para esta empresa.");
    }

    const existingMeta =
      typeof existing.metadata === "object" && existing.metadata !== null
        ? (existing.metadata as Record<string, unknown>)
        : {};
    const priorDiff =
      typeof existingMeta.differenceCents === "number"
        ? existingMeta.differenceCents
        : 0;

    const policy = evaluateReconciliationDifferencePolicy({
      bankAmountCents: params.bankAmountCents,
      targetAmountCents: params.targetAmountCents,
      priorDifferenceCents: priorDiff,
      disposition: params.disposition,
      reason: params.notes,
    });

    if (!policy.canClose) {
      // Nunca ocultar la diferencia: mantener/actualizar la diferencia visible y rechazar el cierre silencioso.
      await tx
        .update(exceptions)
        .set({
          metadata: {
            ...existingMeta,
            differenceCents: policy.differenceCents,
            discrepancyCode: "AMOUNT_DIFFERENCE",
            lastEvaluatedAt: now.toISOString(),
          },
          updatedAt: now,
        })
        .where(
          and(
            eq(exceptions.id, existing.id),
            eq(exceptions.companyId, params.companyId),
          ),
        );
      throw ApiError.conflict(
        policy.blockingReason ??
          "No se puede cerrar la excepción bancaria ocultando una diferencia.",
      );
    }

    const effectiveNotes =
      params.notes && params.notes.trim().length >= 4
        ? params.notes.trim()
        : `Conciliación bancaria trazable (${policy.effectiveDisposition}) contra ${params.matchedTargetType}${params.matchedTargetId ? `:${params.matchedTargetId}` : ""}`;

    const trace: BankReconciliationTrace = {
      reconciledAt: now.toISOString(),
      reconciledBy: params.actorId,
      matchedTargetType: params.matchedTargetType,
      matchedTargetId: params.matchedTargetId,
      bankAmountCents: params.bankAmountCents,
      targetAmountCents: params.targetAmountCents,
      differenceCents: policy.differenceCents,
      disposition: policy.effectiveDisposition!,
      notes: effectiveNotes,
    };

    const valueDate =
      typeof existingMeta.valueDate === "string"
        ? existingMeta.valueDate
        : now.toISOString().slice(0, 10);

    await tx
      .update(exceptions)
      .set({
        metadata: {
          ...existingMeta,
          ageDays: computeBankAgingDays(valueDate, now),
          differenceCents: policy.differenceCents,
          reconciliationTrace: trace,
          lastEvaluatedAt: now.toISOString(),
        },
        updatedAt: now,
      })
      .where(
        and(
          eq(exceptions.id, existing.id),
          eq(exceptions.companyId, params.companyId),
        ),
      );

    let finalException: ExceptionRow = existing;
    if (!isTerminal(existing.status)) {
      if (existing.status === "VERIFIED") {
        finalException = await ExceptionService.close(
          existing.id,
          params.companyId,
          params.actorId,
          tx,
          { expectedStatus: "VERIFIED" },
        );
      } else if (
        existing.status === "RESOLVED" &&
        existing.resolvedBy &&
        existing.resolvedBy !== params.actorId
      ) {
        await ExceptionService.verify(
          existing.id,
          params.companyId,
          params.actorId,
          tx,
          { expectedStatus: "RESOLVED" },
        );
        finalException = await ExceptionService.close(
          existing.id,
          params.companyId,
          params.actorId,
          tx,
          { expectedStatus: "VERIFIED" },
        );
      } else {
        finalException = await ExceptionService.cancel(
          existing.id,
          params.companyId,
          params.actorId,
          effectiveNotes,
          tx,
          { expectedStatus: existing.status },
        );
      }
    } else {
      finalException = await ExceptionService.getById(
        existing.id,
        params.companyId,
        tx,
      );
    }

    await AuditService.logCriticalEmployeeAction(
      {
        userId: params.actorId,
        performedBy: params.actorId,
        action: "UPDATE",
        entityType: "BANK_RECONCILIATION",
        entityId: existing.id,
        oldValue: {
          status: existing.status,
          sourceKind: existingMeta.sourceKind ?? params.sourceKind,
          sourceId: existingMeta.sourceId ?? params.sourceId,
          valueDate,
          differenceCents: priorDiff,
        },
        newValue: {
          status: finalException.status,
          reconciliationTrace: trace,
        },
        reason: effectiveNotes,
        isCritical: true,
      },
      tx,
    );

    return {
      closed: true,
      differenceCents: policy.differenceCents,
      exception: finalException,
      trace,
    };
  };

  if (executor && executor !== db) return run(executor);
  return db.transaction(async (tx) => run(tx));
}

/**
 * Hook seguro dentro de la transacción de `confirmMatch` / `confirmDepositMatch`:
 * verifica privilegios reales (`has_table_privilege`) antes de consultar
 * `exceptions` y `employee_audit_logs` para no romper roles mínimos de pruebas
 * previas (BAN-04/BAN-06.a), y cuando hay privilegio cierra atómicamente las
 * excepciones abiertas del movimiento y su contraparte sin ocultar diferencias.
 */
export async function tryResolveBankExceptionOnExactMatchInTx(
  tx: DbExecutor,
  params: {
    companyId: string;
    bankTransactionId: string;
    bankAmountCents: number;
    targetType: "PAYMENT_RUN_ITEM" | "GATEWAY_TRANSACTION";
    targetId: string;
    targetAmountCents: number;
    actorId: string;
    notes?: string | null;
  },
): Promise<void> {
  if (typeof (tx as { execute?: unknown }).execute !== "function") return;

  const privCheck = await tx.execute(sql`
    SELECT
      to_regclass('exceptions') IS NOT NULL
      AND to_regclass('employee_audit_logs') IS NOT NULL
      AND has_table_privilege(current_user, 'exceptions', 'SELECT, UPDATE')
      AND has_table_privilege(current_user, 'employee_audit_logs', 'INSERT') AS can_sync
  `);
  const canSync = Boolean((privCheck.rows?.[0] as { can_sync?: boolean } | undefined)?.can_sync);
  if (!canSync) return;

  const bankKind: BankExceptionSourceKind =
    params.bankAmountCents < 0 ? "BANK_OUTFLOW" : "BANK_DEPOSIT";
  const targetKind: BankExceptionSourceKind =
    params.targetType === "PAYMENT_RUN_ITEM"
      ? "PAYMENT_RUN_ITEM"
      : "GATEWAY_TRANSACTION";

  for (const pair of [
    { sourceKind: bankKind, sourceId: params.bankTransactionId },
    { sourceKind: targetKind, sourceId: params.targetId },
  ]) {
    await resolveBankExceptionOnReconciliation(
      {
        companyId: params.companyId,
        sourceKind: pair.sourceKind,
        sourceId: pair.sourceId,
        matchedTargetType: params.targetType,
        matchedTargetId: params.targetId,
        bankAmountCents: params.bankAmountCents,
        targetAmountCents: params.targetAmountCents,
        actorId: params.actorId,
        notes: params.notes,
        disposition: "EXACT_MATCH",
        onlyIfExisting: true,
      },
      tx,
    );
  }
}

/**
 * Barrido idempotente de pagos y depósitos bancarios pendientes o discrepantes
 * para una empresa (controlable por reloj `now` y umbral `pendingThresholdDays`).
 */
export async function syncCompanyBankExceptions(
  params: {
    companyId: string;
    now?: Date;
    pendingThresholdDays?: number;
  },
  executor: DbExecutor = db,
): Promise<BankExceptionSyncSummary> {
  const now = params.now ?? new Date();
  const threshold = params.pendingThresholdDays ?? DEFAULT_BANK_PENDING_THRESHOLD_DAYS;

  let raised = 0;
  let autoClosedExact = 0;
  let keptOpenWithDifference = 0;

  // 1. Movimientos bancarios UNMATCHED (egresos y depósitos)
  const unmatchedBank = await executor
    .select({
      id: bankTransactions.id,
      sourceBankAccountId: bankTransactions.sourceBankAccountId,
      valueDate: bankTransactions.valueDate,
      description: bankTransactions.description,
      reference: bankTransactions.reference,
      amountCents: bankTransactions.amountCents,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.companyId, params.companyId),
        eq(bankTransactions.matchStatus, "UNMATCHED"),
      ),
    );

  // Cargar liquidaciones gateway para detectar depósitos agrupados o sin cuenta
  const allGateways = await executor
    .select({
      id: gatewayTransactions.id,
      branchId: gatewayTransactions.branchId,
      acquirer: gatewayTransactions.acquirer,
      externalId: gatewayTransactions.externalId,
      grossAmountCents: gatewayTransactions.grossAmountCents,
      feeAmountCents: gatewayTransactions.feeAmountCents,
      feeVatCents: gatewayTransactions.feeVatCents,
      netAmountCents: gatewayTransactions.netAmountCents,
      destinationBankAccountId: gatewayTransactions.destinationBankAccountId,
      settlementDate: gatewayTransactions.settlementDate,
      transactionDate: gatewayTransactions.transactionDate,
    })
    .from(gatewayTransactions)
    .where(eq(gatewayTransactions.companyId, params.companyId));

  const matchedBankRows = await executor
    .select({
      id: bankTransactions.id,
      amountCents: bankTransactions.amountCents,
      matchedPaymentRunItemId: bankTransactions.matchedPaymentRunItemId,
      matchedGatewayTransactionId: bankTransactions.matchedGatewayTransactionId,
      matchedBy: bankTransactions.matchedBy,
      matchNotes: bankTransactions.matchNotes,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.companyId, params.companyId),
        eq(bankTransactions.matchStatus, "MATCHED"),
      ),
    );

  const matchedGwIds = new Set(
    matchedBankRows
      .map((r) => r.matchedGatewayTransactionId)
      .filter((id): id is string => Boolean(id)),
  );
  const matchedPaymentItemIds = new Set(
    matchedBankRows
      .map((r) => r.matchedPaymentRunItemId)
      .filter((id): id is string => Boolean(id)),
  );

  for (const txRow of unmatchedBank) {
    const ageDays = computeBankAgingDays(txRow.valueDate, now);
    const isDeposit = txRow.amountCents > 0;
    let discrepancyCode: BankDiscrepancyCode | null = null;

    if (isDeposit && txRow.sourceBankAccountId) {
      // Detectar depósito agrupado 1↔N no soportado (BAN-06.a)
      const sameAcctUnmatched = allGateways.filter(
        (g) =>
          !matchedGwIds.has(g.id) &&
          g.destinationBankAccountId === txRow.sourceBankAccountId,
      );
      const exactExists = sameAcctUnmatched.some(
        (g) => g.netAmountCents === txRow.amountCents,
      );
      if (!exactExists && sameAcctUnmatched.length >= 2) {
        const sample = sameAcctUnmatched.slice(0, 16).map((g) => g.netAmountCents);
        let grouped = false;
        const dfs = (idx: number, count: number, sum: number) => {
          if (grouped || sum > txRow.amountCents) return;
          if (count >= 2 && sum === txRow.amountCents) {
            grouped = true;
            return;
          }
          for (let i = idx; i < sample.length && !grouped; i++) {
            if (sample[i] > 0) dfs(i + 1, count + 1, sum + sample[i]);
          }
        };
        dfs(0, 0, 0);
        if (grouped) {
          discrepancyCode = "GROUPED_DEPOSIT_UNSUPPORTED";
        }
      }
    }

    if (!discrepancyCode && ageDays >= threshold) {
      discrepancyCode = "PENDING_OVERDUE";
    }
    if (!discrepancyCode) continue;

    await recordBankDiscrepancyException(
      {
        companyId: params.companyId,
        source: {
          sourceKind: isDeposit ? "BANK_DEPOSIT" : "BANK_OUTFLOW",
          sourceTable: "bank_transactions",
          sourceId: txRow.id,
          sourceBankAccountId: txRow.sourceBankAccountId,
          direction: isDeposit ? "INFLOW" : "OUTFLOW",
          valueDate: txRow.valueDate,
          amountCents: txRow.amountCents,
          expectedAmountCents: null,
          differenceCents: 0,
          discrepancyCode,
          reference: txRow.reference,
          description: txRow.description,
        },
        now,
      },
      executor,
    );
    raised++;
  }

  // 2. Liquidaciones de pasarela sin conciliar (discrepancia aritmética, sin cuenta destino o vencidas)
  for (const gw of allGateways) {
    if (matchedGwIds.has(gw.id)) continue;
    const valueDate =
      gw.settlementDate ?? gw.transactionDate.toISOString().slice(0, 10);
    const ageDays = computeBankAgingDays(valueDate, now);
    const expectedNet =
      gw.grossAmountCents - gw.feeAmountCents - (gw.feeVatCents ?? 0);
    const arithmeticDiff = gw.netAmountCents - expectedNet;

    let discrepancyCode: BankDiscrepancyCode | null = null;
    if (Math.abs(arithmeticDiff) > 1) {
      discrepancyCode = "ARITHMETIC_NET_MISMATCH";
    } else if (!gw.destinationBankAccountId) {
      discrepancyCode = "MISSING_DESTINATION_ACCOUNT";
    } else if (ageDays >= threshold) {
      discrepancyCode = "PENDING_OVERDUE";
    }
    if (!discrepancyCode) continue;

    await recordBankDiscrepancyException(
      {
        companyId: params.companyId,
        branchId: gw.branchId,
        source: {
          sourceKind: "GATEWAY_TRANSACTION",
          sourceTable: "gateway_transactions",
          sourceId: gw.id,
          sourceBankAccountId: gw.destinationBankAccountId,
          direction: "INFLOW",
          valueDate,
          amountCents: gw.netAmountCents,
          expectedAmountCents: expectedNet,
          differenceCents: Math.abs(arithmeticDiff) > 1 ? arithmeticDiff : 0,
          discrepancyCode,
          reference: gw.externalId,
          description: `Pasarela ${gw.acquirer} (${valueDate})`,
        },
        now,
      },
      executor,
    );
    raised++;
  }

  // 3. Partidas de corrida de pago CONFIRMED sin conciliar en banco y vencidas
  const confirmedPayments = await executor
    .select({
      id: paymentRunItems.id,
      amountCents: paymentRunItems.amountCents,
      settledAt: paymentRunItems.settledAt,
      settlementReference: paymentRunItems.settlementReference,
      itemType: paymentRunItems.itemType,
      referenceId: paymentRunItems.referenceId,
      sourceBankAccountId: paymentRuns.sourceBankAccountId,
      runCreatedAt: paymentRuns.createdAt,
    })
    .from(paymentRunItems)
    .innerJoin(paymentRuns, eq(paymentRuns.id, paymentRunItems.paymentRunId))
    .where(
      and(
        eq(paymentRuns.companyId, params.companyId),
        eq(paymentRunItems.settlementStatus, "CONFIRMED"),
      ),
    );

  for (const item of confirmedPayments) {
    if (matchedPaymentItemIds.has(item.id)) continue;
    const valueDate = (item.settledAt ?? item.runCreatedAt)
      .toISOString()
      .slice(0, 10);
    const ageDays = computeBankAgingDays(valueDate, now);
    if (ageDays < threshold) continue;

    await recordBankDiscrepancyException(
      {
        companyId: params.companyId,
        source: {
          sourceKind: "PAYMENT_RUN_ITEM",
          sourceTable: "payment_run_items",
          sourceId: item.id,
          sourceBankAccountId: item.sourceBankAccountId,
          direction: "OUTFLOW",
          valueDate,
          amountCents: item.amountCents,
          expectedAmountCents: item.amountCents,
          differenceCents: 0,
          discrepancyCode: "PENDING_OVERDUE",
          reference: item.settlementReference,
          description: `Partida ${item.itemType} (${item.referenceId})`,
        },
        now,
      },
      executor,
    );
    raised++;
  }

  // 4. Autorreconciliación: solo cierra excepciones abiertas cuando el cruce es exacto (differenceCents === 0)
  for (const matched of matchedBankRows) {
    const bankSubject = buildBankSubjectId(
      matched.amountCents < 0 ? "BANK_OUTFLOW" : "BANK_DEPOSIT",
      matched.id,
    );
    const existing = await ExceptionService.getBySubject(
      params.companyId,
      BANK_EXCEPTION_SUBJECT_TYPE,
      bankSubject,
      executor,
    );
    if (!existing || isTerminal(existing.status)) continue;

    const meta =
      typeof existing.metadata === "object" && existing.metadata !== null
        ? (existing.metadata as Record<string, unknown>)
        : {};
    const priorDiff =
      typeof meta.differenceCents === "number" ? meta.differenceCents : 0;

    if (priorDiff !== 0) {
      keptOpenWithDifference++;
      continue;
    }

    await ExceptionService.cancel(
      existing.id,
      params.companyId,
      null,
      `Conciliación exacta confirmada (${matched.matchedPaymentRunItemId ?? matched.matchedGatewayTransactionId ?? matched.id}).`,
      executor,
      { expectedStatus: existing.status },
    ).catch(() => {
      /* ya cerrada concurrentemente */
    });
    autoClosedExact++;
  }

  return {
    raised,
    autoClosedExact,
    keptOpenWithDifference,
    evaluatedAt: now.toISOString(),
  };
}

export async function listBankExceptions(
  params: {
    companyId: string;
    status?: string;
    sourceKind?: BankExceptionSourceKind;
    limit?: number;
  },
  executor: DbExecutor = db,
) {
  const rows = await executor
    .select()
    .from(exceptions)
    .where(
      and(
        eq(exceptions.companyId, params.companyId),
        eq(exceptions.subjectType, BANK_EXCEPTION_SUBJECT_TYPE),
      ),
    )
    .orderBy(desc(exceptions.createdAt))
    .limit(params.limit ?? 200);

  return rows
    .filter((r) => !params.status || r.status === params.status)
    .map((r) => {
      const meta =
        typeof r.metadata === "object" && r.metadata !== null
          ? (r.metadata as Record<string, unknown>)
          : {};
      return {
        id: r.id,
        companyId: r.companyId,
        branchId: r.branchId,
        status: r.status,
        severity: r.severity,
        ownerId: r.ownerId,
        reason: r.reason,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        sourceKind: (meta.sourceKind as BankExceptionSourceKind | undefined) ?? null,
        sourceTable: (meta.sourceTable as string | undefined) ?? null,
        sourceId: (meta.sourceId as string | undefined) ?? null,
        sourceBankAccountId: (meta.sourceBankAccountId as string | null | undefined) ?? null,
        direction: (meta.direction as "OUTFLOW" | "INFLOW" | undefined) ?? null,
        valueDate: (meta.valueDate as string | undefined) ?? null,
        ageDays: typeof meta.ageDays === "number" ? meta.ageDays : null,
        amountCents: typeof meta.amountCents === "number" ? meta.amountCents : null,
        expectedAmountCents:
          typeof meta.expectedAmountCents === "number" ? meta.expectedAmountCents : null,
        differenceCents: typeof meta.differenceCents === "number" ? meta.differenceCents : 0,
        discrepancyCode: (meta.discrepancyCode as BankDiscrepancyCode | undefined) ?? null,
        firstDetectedAt: (meta.firstDetectedAt as string | undefined) ?? null,
        reconciliationTrace:
          (meta.reconciliationTrace as BankReconciliationTrace | null | undefined) ?? null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    })
    .filter((r) => !params.sourceKind || r.sourceKind === params.sourceKind);
}
