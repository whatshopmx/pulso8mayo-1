/**
 * NOM-05 — Enlace de obligación neta de nómina aprobada con tesorería.
 *
 * Garantías:
 * - Una única obligación por `(company_id, user_id, period_start, period_end)`
 *   alimentada exclusivamente desde el snapshot inmutable aprobado (`ordinary_snapshot`).
 * - Pagos parciales, repetición idempotente y conciliación bancaria (`BAN-04`)
 *   conservan neto, pagado y saldo restante sin sobrepago ni doble contabilización.
 * - El estado de pago en tesorería (`OPEN | PARTIALLY_PAID | PAID`) y el estado
 *   fiscal CFDI (`cfdi_status` / `cfdi_uuid`) permanecen completamente independientes.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { withCompanyContext } from "@/lib/db/tenant-context";
import {
  bankTransactions,
  paymentRunItems,
  paymentRuns,
  payrollPayslips,
  payrollTreasuryAllocations,
  payrollTreasuryObligations,
} from "@/lib/db/schema";
import { readApprovedPayrollSnapshot } from "./payroll-snapshot-service";

export type PayrollObligationPaymentStatus = "OPEN" | "PARTIALLY_PAID" | "PAID";
export type BankReconciliationState = "UNMATCHED" | "PARTIALLY_RECONCILED" | "RECONCILED";

export interface PayrollTreasuryObligationView {
  id: string;
  companyId: string;
  payrollRunId: string;
  payslipId: string | null;
  userId: string;
  periodStart: string;
  periodEnd: string;
  snapshotVersion: number;
  netAmountCents: number;
  paidAmountCents: number;
  remainingAmountCents: number;
  paymentStatus: PayrollObligationPaymentStatus;
  /** Estado CFDI leído independientemente de `payroll_payslips` (sin acoplarlo al pago). */
  cfdiStatus: string | null;
  cfdiUuid: string | null;
  /** Conciliación bancaria acumulada vía `BAN-04` sobre las partidas asignadas. */
  bankReconciledCents: number;
  bankReconciliationStatus: BankReconciliationState;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runInScope<T>(companyId: string, actorId: string | undefined, dbInstance: any, fn: (tx: any) => Promise<T>): Promise<T> {
  if (dbInstance) {
    return fn(dbInstance);
  }
  return withCompanyContext({ companyId, actorId }, fn);
}

/**
 * Genera de forma idempotente una obligación neta por cada empleado del
 * snapshot aprobado (`ordinary_snapshot`). Repetir sobre la misma corrida o
 * período no duplica obligaciones ni altera saldos ya pagados.
 * No exige que el CFDI esté timbrado: CFDI y pago mantienen estados independientes.
 */
export async function syncPayrollObligationsFromApprovedSnapshot(
  input: {
    companyId: string;
    runId: string;
    createdBy?: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance?: any
): Promise<{
  runId: string;
  snapshotVersion: number;
  createdCount: number;
  existingCount: number;
  obligations: PayrollTreasuryObligationView[];
}> {
  return runInScope(input.companyId, input.createdBy, dbInstance, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.companyId}, 603))`);

    const bundle = await readApprovedPayrollSnapshot(input.companyId, input.runId, tx);

    const payslipRows: Array<{
      id: string;
      userId: string;
      cfdiStatus: string | null;
      cfdiUuid: string | null;
    }> = await tx
      .select({
        id: payrollPayslips.id,
        userId: payrollPayslips.userId,
        cfdiStatus: payrollPayslips.cfdiStatus,
        cfdiUuid: payrollPayslips.cfdiUuid,
      })
      .from(payrollPayslips)
      .where(eq(payrollPayslips.runId, bundle.runId));

    const payslipByUser = new Map(payslipRows.map((p) => [p.userId, p]));

    let createdCount = 0;
    let existingCount = 0;

    for (const snap of bundle.payslips) {
      if (snap.netPayCents < 0) {
        throw ApiError.badRequest(
          `El neto del empleado ${snap.employeeName || snap.userId} es negativo (${snap.netPayCents}); revisa el snapshot aprobado.`
        );
      }

      const payslipRow = payslipByUser.get(snap.userId);
      const initialStatus: PayrollObligationPaymentStatus = snap.netPayCents === 0 ? "PAID" : "OPEN";

      const inserted = await tx
        .insert(payrollTreasuryObligations)
        .values({
          companyId: input.companyId,
          payrollRunId: bundle.runId,
          payslipId: payslipRow?.id ?? null,
          userId: snap.userId,
          periodStart: bundle.header.periodStart,
          periodEnd: bundle.header.periodEnd,
          snapshotVersion: bundle.snapshotVersion,
          netAmountCents: snap.netPayCents,
          paidAmountCents: 0,
          remainingAmountCents: snap.netPayCents,
          paymentStatus: initialStatus,
          createdBy: input.createdBy ?? null,
        })
        .onConflictDoNothing({
          target: [
            payrollTreasuryObligations.companyId,
            payrollTreasuryObligations.userId,
            payrollTreasuryObligations.periodStart,
            payrollTreasuryObligations.periodEnd,
          ],
        })
        .returning({ id: payrollTreasuryObligations.id });

      if (inserted.length > 0) createdCount++;
      else existingCount++;
    }

    const obligations = await listPayrollObligations(
      { companyId: input.companyId, runId: bundle.runId },
      tx
    );

    return {
      runId: bundle.runId,
      snapshotVersion: bundle.snapshotVersion,
      createdCount,
      existingCount,
      obligations,
    };
  });
}

/**
 * Registra un pago parcial o total contra una obligación de nómina a partir de
 * una partida de corrida `PAYROLL` confirmada (`CONFIRMED`), con idempotencia
 * por `idempotencyKey`, bloqueo contra sobrepago y sin tocar el estado CFDI.
 */
export async function recordPayrollObligationPayment(
  input: {
    companyId: string;
    obligationId: string;
    paymentRunItemId: string;
    amountCents: number;
    idempotencyKey: string;
    actorId?: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance?: any
): Promise<{
  idempotent: boolean;
  allocationId: string;
  obligation: PayrollTreasuryObligationView;
}> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw ApiError.badRequest("El importe del pago debe ser un entero positivo en centavos.");
  }
  const idem = input.idempotencyKey?.trim();
  if (!idem) {
    throw ApiError.badRequest("Se requiere `idempotencyKey` para registrar pagos de nómina.");
  }

  return runInScope(input.companyId, input.actorId, dbInstance, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.companyId}, 603))`);

    const [existingAlloc] = await tx
      .select({
        id: payrollTreasuryAllocations.id,
        obligationId: payrollTreasuryAllocations.obligationId,
        paymentRunItemId: payrollTreasuryAllocations.paymentRunItemId,
        amountCents: payrollTreasuryAllocations.amountCents,
      })
      .from(payrollTreasuryAllocations)
      .where(
        and(
          eq(payrollTreasuryAllocations.companyId, input.companyId),
          eq(payrollTreasuryAllocations.idempotencyKey, idem)
        )
      )
      .limit(1);

    if (existingAlloc) {
      if (
        existingAlloc.obligationId !== input.obligationId ||
        existingAlloc.paymentRunItemId !== input.paymentRunItemId ||
        existingAlloc.amountCents !== input.amountCents
      ) {
        throw ApiError.conflict(
          "La clave de idempotencia ya fue utilizada con parámetros distintos de obligación, partida o monto."
        );
      }
      const [current] = await listPayrollObligations(
        { companyId: input.companyId, obligationId: input.obligationId },
        tx
      );
      return { idempotent: true, allocationId: existingAlloc.id, obligation: current };
    }

    const [obligation] = await tx
      .select()
      .from(payrollTreasuryObligations)
      .where(
        and(
          eq(payrollTreasuryObligations.id, input.obligationId),
          eq(payrollTreasuryObligations.companyId, input.companyId)
        )
      )
      .for("update")
      .limit(1);

    if (!obligation) {
      throw ApiError.notFound("Obligación de nómina no encontrada.");
    }

    const [item] = await tx
      .select({
        id: paymentRunItems.id,
        itemType: paymentRunItems.itemType,
        settlementStatus: paymentRunItems.settlementStatus,
        amountCents: paymentRunItems.amountCents,
      })
      .from(paymentRunItems)
      .innerJoin(paymentRuns, eq(paymentRuns.id, paymentRunItems.paymentRunId))
      .where(
        and(
          eq(paymentRunItems.id, input.paymentRunItemId),
          eq(paymentRuns.companyId, input.companyId)
        )
      )
      .for("update")
      .limit(1);

    if (!item) {
      throw ApiError.notFound("Partida de corrida de pago no encontrada.");
    }
    if (item.itemType !== "PAYROLL") {
      throw ApiError.badRequest("La partida de corrida debe ser de tipo PAYROLL.");
    }
    if (item.settlementStatus !== "CONFIRMED") {
      throw ApiError.conflict(
        `Solo una partida PAYROLL en estado CONFIRMED puede aplicarse a la obligación (estado actual: ${item.settlementStatus}).`
      );
    }

    // Verificar que la suma de asignaciones de esta partida no exceda el monto de la partida
    const itemAllocs: Array<{ amountCents: number; obligationId: string }> = await tx
      .select({
        amountCents: payrollTreasuryAllocations.amountCents,
        obligationId: payrollTreasuryAllocations.obligationId,
      })
      .from(payrollTreasuryAllocations)
      .where(
        and(
          eq(payrollTreasuryAllocations.companyId, input.companyId),
          eq(payrollTreasuryAllocations.paymentRunItemId, input.paymentRunItemId)
        )
      );

    if (itemAllocs.some((a) => a.obligationId === input.obligationId)) {
      throw ApiError.conflict("Esta partida ya fue aplicada a la obligación indicada.");
    }
    const alreadyAllocatedFromItem = itemAllocs.reduce((acc, a) => acc + a.amountCents, 0);
    if (alreadyAllocatedFromItem + input.amountCents > item.amountCents) {
      throw ApiError.conflict(
        `El pago excede el monto disponible de la partida (${item.amountCents - alreadyAllocatedFromItem} centavos disponibles).`
      );
    }

    if (input.amountCents > obligation.remainingAmountCents) {
      throw ApiError.conflict(
        `Sobrepago rechazado: importe ${input.amountCents} excede el saldo restante ${obligation.remainingAmountCents}.`
      );
    }

    const [createdAlloc] = await tx
      .insert(payrollTreasuryAllocations)
      .values({
        companyId: input.companyId,
        obligationId: obligation.id,
        paymentRunItemId: item.id,
        amountCents: input.amountCents,
        idempotencyKey: idem,
        createdBy: input.actorId ?? null,
      })
      .returning({ id: payrollTreasuryAllocations.id });

    const nextPaid = obligation.paidAmountCents + input.amountCents;
    const nextRemaining = obligation.netAmountCents - nextPaid;
    const nextStatus: PayrollObligationPaymentStatus =
      nextRemaining === 0 ? "PAID" : "PARTIALLY_PAID";

    await tx
      .update(payrollTreasuryObligations)
      .set({
        paidAmountCents: nextPaid,
        remainingAmountCents: nextRemaining,
        paymentStatus: nextStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payrollTreasuryObligations.id, obligation.id),
          eq(payrollTreasuryObligations.companyId, input.companyId)
        )
      );

    const [updated] = await listPayrollObligations(
      { companyId: input.companyId, obligationId: obligation.id },
      tx
    );

    return {
      idempotent: false,
      allocationId: createdAlloc.id,
      obligation: updated,
    };
  });
}

/**
 * Consulta obligaciones netas de nómina combinando:
 * 1) Estado de pago en tesorería (`OPEN | PARTIALLY_PAID | PAID`)
 * 2) Estado CFDI independiente (`payroll_payslips.cfdi_status` / `cfdi_uuid`)
 * 3) Conciliación bancaria (`bank_transactions` con `match_status = 'MATCHED'` vía BAN-04)
 */
export async function listPayrollObligations(
  params: {
    companyId: string;
    runId?: string;
    obligationId?: string;
    paymentStatus?: PayrollObligationPaymentStatus;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance?: any
): Promise<PayrollTreasuryObligationView[]> {
  return runInScope(params.companyId, undefined, dbInstance, async (tx) => {
    const conditions = [eq(payrollTreasuryObligations.companyId, params.companyId)];
    if (params.runId) conditions.push(eq(payrollTreasuryObligations.payrollRunId, params.runId));
    if (params.obligationId) conditions.push(eq(payrollTreasuryObligations.id, params.obligationId));
    if (params.paymentStatus) conditions.push(eq(payrollTreasuryObligations.paymentStatus, params.paymentStatus));

    const rows: Array<{
      id: string;
      companyId: string;
      payrollRunId: string;
      payslipId: string | null;
      userId: string;
      periodStart: string;
      periodEnd: string;
      snapshotVersion: number;
      netAmountCents: number;
      paidAmountCents: number;
      remainingAmountCents: number;
      paymentStatus: string;
      cfdiStatus: string | null;
      cfdiUuid: string | null;
    }> = await tx
      .select({
        id: payrollTreasuryObligations.id,
        companyId: payrollTreasuryObligations.companyId,
        payrollRunId: payrollTreasuryObligations.payrollRunId,
        payslipId: payrollTreasuryObligations.payslipId,
        userId: payrollTreasuryObligations.userId,
        periodStart: payrollTreasuryObligations.periodStart,
        periodEnd: payrollTreasuryObligations.periodEnd,
        snapshotVersion: payrollTreasuryObligations.snapshotVersion,
        netAmountCents: payrollTreasuryObligations.netAmountCents,
        paidAmountCents: payrollTreasuryObligations.paidAmountCents,
        remainingAmountCents: payrollTreasuryObligations.remainingAmountCents,
        paymentStatus: payrollTreasuryObligations.paymentStatus,
        cfdiStatus: payrollPayslips.cfdiStatus,
        cfdiUuid: payrollPayslips.cfdiUuid,
      })
      .from(payrollTreasuryObligations)
      .leftJoin(payrollPayslips, eq(payrollPayslips.id, payrollTreasuryObligations.payslipId))
      .where(and(...conditions));

    if (rows.length === 0) return [];

    const obligationIds = rows.map((r) => r.id);
    const allocRows: Array<{
      obligationId: string;
      amountCents: number;
      paymentRunItemId: string;
    }> = await tx
      .select({
        obligationId: payrollTreasuryAllocations.obligationId,
        amountCents: payrollTreasuryAllocations.amountCents,
        paymentRunItemId: payrollTreasuryAllocations.paymentRunItemId,
      })
      .from(payrollTreasuryAllocations)
      .where(
        and(
          eq(payrollTreasuryAllocations.companyId, params.companyId),
          inArray(payrollTreasuryAllocations.obligationId, obligationIds)
        )
      );

    const itemIds = [...new Set(allocRows.map((a) => a.paymentRunItemId))];
    const matchedItemIds = new Set<string>();
    if (itemIds.length > 0) {
      const matchedTxs: Array<{ matchedPaymentRunItemId: string | null }> = await tx
        .select({ matchedPaymentRunItemId: bankTransactions.matchedPaymentRunItemId })
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.companyId, params.companyId),
            eq(bankTransactions.matchStatus, "MATCHED"),
            inArray(bankTransactions.matchedPaymentRunItemId, itemIds)
          )
        );
      for (const t of matchedTxs) {
        if (t.matchedPaymentRunItemId) matchedItemIds.add(t.matchedPaymentRunItemId);
      }
    }

    const reconciledByObligation = new Map<string, number>();
    for (const a of allocRows) {
      if (matchedItemIds.has(a.paymentRunItemId)) {
        reconciledByObligation.set(
          a.obligationId,
          (reconciledByObligation.get(a.obligationId) ?? 0) + a.amountCents
        );
      }
    }

    return rows
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .map((r) => {
        const bankReconciledCents = reconciledByObligation.get(r.id) ?? 0;
        const bankReconciliationStatus: BankReconciliationState =
          bankReconciledCents === 0
            ? "UNMATCHED"
            : bankReconciledCents >= r.netAmountCents
              ? "RECONCILED"
              : "PARTIALLY_RECONCILED";

        return {
          ...r,
          paymentStatus: r.paymentStatus as PayrollObligationPaymentStatus,
          bankReconciledCents,
          bankReconciliationStatus,
        };
      });
  });
}
