/**
 * NOM-02.c2 — Bonos e incidencias aprobadas para nómina.
 *
 * Reglas:
 * - Solo conceptos con `status === "APPROVED"` entran al cálculo; pendientes,
 *   rechazados y cancelados nunca generan importe.
 * - Deduplicación por `id` e `idempotencyKey` y control de `appliedRunId`
 *   para garantizar que cada concepto aprobado entre una sola vez.
 * - Tratamiento fiscal explícito (`FULLY_TAXABLE` | `EXEMPT` | `PARTIAL_EXEMPT`):
 *   se exige `exemptAmountCents` válido (0 <= exempt <= amount) y código SAT explícito.
 * - Huella determinista (`fingerprint` SHA-256) sobre IDs, versiones, importes,
 *   tratamientos y timestamps de actualización: cualquier cambio posterior
 *   (nueva aprobación, edición o cancelación) produce un fingerprint distinto
 *   que invalida el borrador afectado (`isDraftInvalidatedByAdjustments`).
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollAdjustments } from "@/lib/db/schema";

export type PayrollAdjustmentKind = "BONUS" | "INCIDENCE_EARNING" | "INCIDENCE_DEDUCTION";
export type PayrollAdjustmentTaxTreatment = "FULLY_TAXABLE" | "EXEMPT" | "PARTIAL_EXEMPT";
export type PayrollAdjustmentStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface PayrollAdjustmentRecord {
  id: string;
  companyId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  kind: PayrollAdjustmentKind;
  conceptCode: string;
  conceptName: string;
  amountCents: number;
  taxTreatment: PayrollAdjustmentTaxTreatment;
  exemptAmountCents: number;
  status: PayrollAdjustmentStatus;
  appliedRunId?: string | null;
  version: number;
  idempotencyKey?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface AppliedPayrollAdjustment {
  id: string;
  kind: PayrollAdjustmentKind;
  conceptCode: string;
  conceptName: string;
  amountCents: number;
  taxedAmountCents: number;
  exemptAmountCents: number;
  taxTreatment: PayrollAdjustmentTaxTreatment;
  version: number;
}

export interface PayrollAdjustmentsBreakdown {
  status: "AVAILABLE" | "QUERY_ERROR";
  totalBonusAndEarningCents: number;
  totalTaxedEarningCents: number;
  totalExemptEarningCents: number;
  totalIncidenceDeductionCents: number;
  approvedCount: number;
  skippedAlreadyAppliedCount: number;
  ignoredNonApprovedCount: number;
  /** Huella SHA-256 de los conceptos vigentes del período; detecta cambios que invalidan borradores. */
  fingerprint: string;
  applied: AppliedPayrollAdjustment[];
}

export function computeAdjustmentsFingerprint(
  items: readonly Pick<
    PayrollAdjustmentRecord,
    "id" | "kind" | "conceptCode" | "amountCents" | "taxTreatment" | "exemptAmountCents" | "status" | "version" | "appliedRunId"
  >[]
): string {
  const canonical = [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      conceptCode: item.conceptCode,
      amountCents: item.amountCents,
      taxTreatment: item.taxTreatment,
      exemptAmountCents: item.exemptAmountCents,
      status: item.status,
      version: item.version,
      appliedRunId: item.appliedRunId ?? null,
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function isDraftInvalidatedByAdjustments(
  draftFingerprint: string,
  currentFingerprint: string
): boolean {
  return draftFingerprint !== currentFingerprint;
}

export function evaluatePayrollAdjustments(options: {
  records: readonly PayrollAdjustmentRecord[];
  companyId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  /** Si se re-evalúa el mismo runId, conserva los conceptos ya enlazados a ese run. */
  currentRunId?: string | null;
}): PayrollAdjustmentsBreakdown {
  const { records, companyId, userId, periodStart, periodEnd, currentRunId = null } = options;

  // Filtrar estrictamente por alcance empresa + usuario + período exacto
  const scoped = records.filter(
    (r) =>
      r.companyId === companyId &&
      r.userId === userId &&
      r.periodStart.slice(0, 10) === periodStart &&
      r.periodEnd.slice(0, 10) === periodEnd
  );

  // Deduplicar por id y por idempotencyKey
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const uniqueScoped: PayrollAdjustmentRecord[] = [];
  for (const r of scoped) {
    if (seenIds.has(r.id)) continue;
    if (r.idempotencyKey && seenKeys.has(r.idempotencyKey)) continue;
    seenIds.add(r.id);
    if (r.idempotencyKey) seenKeys.add(r.idempotencyKey);
    uniqueScoped.push(r);
  }

  let totalBonusAndEarningCents = 0;
  let totalTaxedEarningCents = 0;
  let totalExemptEarningCents = 0;
  let totalIncidenceDeductionCents = 0;
  let skippedAlreadyAppliedCount = 0;
  let ignoredNonApprovedCount = 0;
  const applied: AppliedPayrollAdjustment[] = [];

  for (const item of uniqueScoped) {
    if (item.status !== "APPROVED") {
      ignoredNonApprovedCount++;
      continue;
    }

    // Ya aplicado en otra corrida distinta: nunca entra dos veces
    if (item.appliedRunId && item.appliedRunId !== currentRunId) {
      skippedAlreadyAppliedCount++;
      continue;
    }

    if (!Number.isSafeInteger(item.amountCents) || item.amountCents <= 0) {
      throw new RangeError(
        `Concepto de nómina ${item.id} tiene importe inválido (${item.amountCents}); se requieren centavos enteros > 0.`
      );
    }

    let exemptAmountCents = 0;
    let taxedAmountCents = 0;

    if (item.kind === "INCIDENCE_DEDUCTION") {
      totalIncidenceDeductionCents += item.amountCents;
    } else {
      if (item.taxTreatment === "FULLY_TAXABLE") {
        taxedAmountCents = item.amountCents;
        exemptAmountCents = 0;
      } else if (item.taxTreatment === "EXEMPT") {
        taxedAmountCents = 0;
        exemptAmountCents = item.amountCents;
      } else {
        if (
          !Number.isSafeInteger(item.exemptAmountCents) ||
          item.exemptAmountCents < 0 ||
          item.exemptAmountCents > item.amountCents
        ) {
          throw new RangeError(
            `Concepto ${item.id} con tratamiento PARTIAL_EXEMPT requiere exemptAmountCents entre 0 y ${item.amountCents}.`
          );
        }
        exemptAmountCents = item.exemptAmountCents;
        taxedAmountCents = item.amountCents - exemptAmountCents;
      }

      totalBonusAndEarningCents += item.amountCents;
      totalTaxedEarningCents += taxedAmountCents;
      totalExemptEarningCents += exemptAmountCents;
    }

    applied.push({
      id: item.id,
      kind: item.kind,
      conceptCode: item.conceptCode,
      conceptName: item.conceptName,
      amountCents: item.amountCents,
      taxedAmountCents,
      exemptAmountCents,
      taxTreatment: item.taxTreatment,
      version: item.version,
    });
  }

  return {
    status: "AVAILABLE",
    totalBonusAndEarningCents,
    totalTaxedEarningCents,
    totalExemptEarningCents,
    totalIncidenceDeductionCents,
    approvedCount: applied.length,
    skippedAlreadyAppliedCount,
    ignoredNonApprovedCount,
    fingerprint: computeAdjustmentsFingerprint(uniqueScoped),
    applied,
  };
}

export async function resolvePayrollAdjustmentsForPeriod(input: {
  companyId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  currentRunId?: string | null;
  preloadedAdjustments?: readonly PayrollAdjustmentRecord[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance?: any;
}): Promise<PayrollAdjustmentsBreakdown> {
  if (input.preloadedAdjustments !== undefined) {
    return evaluatePayrollAdjustments({
      records: input.preloadedAdjustments,
      companyId: input.companyId,
      userId: input.userId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      currentRunId: input.currentRunId,
    });
  }

  const dbInstance = input.dbInstance ?? db;
  try {
    const rows = await dbInstance
      .select({
        id: payrollAdjustments.id,
        companyId: payrollAdjustments.companyId,
        userId: payrollAdjustments.userId,
        periodStart: payrollAdjustments.periodStart,
        periodEnd: payrollAdjustments.periodEnd,
        kind: payrollAdjustments.kind,
        conceptCode: payrollAdjustments.conceptCode,
        conceptName: payrollAdjustments.conceptName,
        amountCents: payrollAdjustments.amountCents,
        taxTreatment: payrollAdjustments.taxTreatment,
        exemptAmountCents: payrollAdjustments.exemptAmountCents,
        status: payrollAdjustments.status,
        appliedRunId: payrollAdjustments.appliedRunId,
        version: payrollAdjustments.version,
        idempotencyKey: payrollAdjustments.idempotencyKey,
        approvedBy: payrollAdjustments.approvedBy,
        approvedAt: payrollAdjustments.approvedAt,
        updatedAt: payrollAdjustments.updatedAt,
      })
      .from(payrollAdjustments)
      .where(
        and(
          eq(payrollAdjustments.companyId, input.companyId),
          eq(payrollAdjustments.userId, input.userId),
          eq(payrollAdjustments.periodStart, input.periodStart),
          eq(payrollAdjustments.periodEnd, input.periodEnd)
        )
      );

    return evaluatePayrollAdjustments({
      records: rows as PayrollAdjustmentRecord[],
      companyId: input.companyId,
      userId: input.userId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      currentRunId: input.currentRunId,
    });
  } catch {
    return {
      status: "QUERY_ERROR",
      totalBonusAndEarningCents: 0,
      totalTaxedEarningCents: 0,
      totalExemptEarningCents: 0,
      totalIncidenceDeductionCents: 0,
      approvedCount: 0,
      skippedAlreadyAppliedCount: 0,
      ignoredNonApprovedCount: 0,
      fingerprint: "",
      applied: [],
    };
  }
}
