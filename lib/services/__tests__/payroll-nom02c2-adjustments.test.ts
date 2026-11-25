import { describe, expect, it } from "vitest";
import {
  computeAdjustmentsFingerprint,
  evaluatePayrollAdjustments,
  isDraftInvalidatedByAdjustments,
  type PayrollAdjustmentRecord,
} from "../payroll-adjustments-service";
import { construirDesgloseNomina } from "../payroll-service";

const COMPANY = "cmp-nom02c2";
const USER = "usr-nom02c2";
const START = "2026-05-01";
const END = "2026-05-15";

function makeAdj(overrides: Partial<PayrollAdjustmentRecord> = {}): PayrollAdjustmentRecord {
  return {
    id: "adj-1",
    companyId: COMPANY,
    userId: USER,
    periodStart: START,
    periodEnd: END,
    kind: "BONUS",
    conceptCode: "010",
    conceptName: "Premio de puntualidad",
    amountCents: 100_000, // $1,000.00
    taxTreatment: "FULLY_TAXABLE",
    exemptAmountCents: 0,
    status: "APPROVED",
    appliedRunId: null,
    version: 1,
    idempotencyKey: "idem-adj-1",
    approvedBy: "admin-1",
    ...overrides,
  };
}

describe("NOM-02.c2 — Bonos e incidencias aprobadas", () => {
  it("aplica conceptos aprobados con tratamiento fiscal explícito una sola vez", () => {
    const records: PayrollAdjustmentRecord[] = [
      makeAdj({ id: "adj-1", kind: "BONUS", conceptCode: "010", amountCents: 100_000, taxTreatment: "FULLY_TAXABLE" }),
      makeAdj({
        id: "adj-2",
        idempotencyKey: "idem-adj-2",
        kind: "INCIDENCE_EARNING",
        conceptCode: "038",
        conceptName: "Apoyo transporte exento",
        amountCents: 50_000,
        taxTreatment: "EXEMPT",
        exemptAmountCents: 50_000,
      }),
      makeAdj({
        id: "adj-3",
        idempotencyKey: "idem-adj-3",
        kind: "INCIDENCE_EARNING",
        conceptCode: "049",
        conceptName: "Bono mixto",
        amountCents: 80_000,
        taxTreatment: "PARTIAL_EXEMPT",
        exemptAmountCents: 30_000,
      }),
      makeAdj({
        id: "adj-4",
        idempotencyKey: "idem-adj-4",
        kind: "INCIDENCE_DEDUCTION",
        conceptCode: "004",
        conceptName: "Descuento uniforme autorizado",
        amountCents: 25_000,
      }),
    ];

    const res = evaluatePayrollAdjustments({
      records,
      companyId: COMPANY,
      userId: USER,
      periodStart: START,
      periodEnd: END,
    });

    expect(res.status).toBe("AVAILABLE");
    expect(res.approvedCount).toBe(4);
    expect(res.totalBonusAndEarningCents).toBe(230_000);
    expect(res.totalTaxedEarningCents).toBe(150_000); // 100,000 + 0 + 50,000
    expect(res.totalExemptEarningCents).toBe(80_000); // 0 + 50,000 + 30,000
    expect(res.totalIncidenceDeductionCents).toBe(25_000);
    expect(res.fingerprint).toHaveLength(64);

    const desglose = construirDesgloseNomina({
      baseSalaryCents: 750_000,
      propinasCents: 0,
      adjustmentsBreakdown: res,
    });
    expect(desglose.desglosePercepciones.filter((p) => p.code === "010")).toHaveLength(1);
    expect(desglose.desglosePercepciones.find((p) => p.code === "049")).toMatchObject({
      taxedAmount: 50_000,
      exemptAmount: 30_000,
    });
    expect(desglose.desgloseDeducciones.find((d) => d.code === "004")).toMatchObject({
      amount: 25_000,
    });
  });

  it("ignora pendientes/rechazados/cancelados y no aplica dos veces conceptos ya consumidos o duplicados", () => {
    const records: PayrollAdjustmentRecord[] = [
      makeAdj({ id: "adj-ok", idempotencyKey: "k-ok", amountCents: 50_000 }),
      // Duplicado por idempotencyKey
      makeAdj({ id: "adj-dup-key", idempotencyKey: "k-ok", amountCents: 50_000 }),
      // Ya aplicado en otra corrida
      makeAdj({ id: "adj-applied", idempotencyKey: "k-applied", amountCents: 40_000, appliedRunId: "run-prev" }),
      // Pendiente, rechazado y cancelado
      makeAdj({ id: "adj-pend", idempotencyKey: "k-pend", status: "PENDING" }),
      makeAdj({ id: "adj-rej", idempotencyKey: "k-rej", status: "REJECTED" }),
      makeAdj({ id: "adj-can", idempotencyKey: "k-can", status: "CANCELLED" }),
      // Otra empresa (nunca entra)
      makeAdj({ id: "adj-other-co", idempotencyKey: "k-other", companyId: "cmp-other" }),
    ];

    const res = evaluatePayrollAdjustments({
      records,
      companyId: COMPANY,
      userId: USER,
      periodStart: START,
      periodEnd: END,
      currentRunId: "run-new",
    });

    expect(res.approvedCount).toBe(1);
    expect(res.totalBonusAndEarningCents).toBe(50_000);
    expect(res.skippedAlreadyAppliedCount).toBe(1);
    expect(res.ignoredNonApprovedCount).toBe(3);
  });

  it("cambios posteriores (edición, versión o cancelación) cambian el fingerprint e invalidan el borrador", () => {
    const initial = [makeAdj({ id: "adj-1", amountCents: 100_000, version: 1 })];
    const draftFp = computeAdjustmentsFingerprint(initial);

    // Mismo conjunto -> no invalida
    expect(isDraftInvalidatedByAdjustments(draftFp, computeAdjustmentsFingerprint(initial))).toBe(false);

    // Cambio de importe / versión -> invalida borrador
    const edited = [makeAdj({ id: "adj-1", amountCents: 120_000, version: 2 })];
    expect(isDraftInvalidatedByAdjustments(draftFp, computeAdjustmentsFingerprint(edited))).toBe(true);

    // Cancelación posterior -> invalida borrador
    const cancelled = [makeAdj({ id: "adj-1", status: "CANCELLED", version: 2 })];
    expect(isDraftInvalidatedByAdjustments(draftFp, computeAdjustmentsFingerprint(cancelled))).toBe(true);
  });

  it("rechaza importes inválidos o exención mayor al importe con RangeError", () => {
    expect(() =>
      evaluatePayrollAdjustments({
        records: [makeAdj({ amountCents: 0 })],
        companyId: COMPANY,
        userId: USER,
        periodStart: START,
        periodEnd: END,
      })
    ).toThrow(RangeError);

    expect(() =>
      evaluatePayrollAdjustments({
        records: [makeAdj({ taxTreatment: "PARTIAL_EXEMPT", amountCents: 50_000, exemptAmountCents: 60_000 })],
        companyId: COMPANY,
        userId: USER,
        periodStart: START,
        periodEnd: END,
      })
    ).toThrow(RangeError);
  });
});
