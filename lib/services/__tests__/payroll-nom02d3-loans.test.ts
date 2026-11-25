import { describe, expect, it } from "vitest";
import {
  planPayrollLoanDeductions,
  type PayrollLoanInstallmentRecord,
  type PayrollLoanRecord,
} from "../payroll-loans-service";
import { construirDesgloseNomina } from "../payroll-service";

const COMPANY = "cmp-nom02d3";
const USER = "usr-nom02d3";
const START = "2026-05-01";
const END = "2026-05-15";

function makeLoan(overrides: Partial<PayrollLoanRecord> = {}): PayrollLoanRecord {
  return {
    id: "loan-1",
    companyId: COMPANY,
    userId: USER,
    loanType: "COMPANY_LOAN",
    satDeductionCode: "004",
    conceptName: "Préstamo personal autorizado",
    principalCents: 500_000, // $5,000.00
    remainingBalanceCents: 200_000, // $2,000.00
    installmentCents: 50_000, // $500.00 por quincena
    maxDeductionPct: 30,
    status: "ACTIVE",
    authorizedBy: "admin-1",
    authorizedAt: "2026-04-01T12:00:00Z",
    reason: "Autorización firmada folio PR-001",
    ...overrides,
  };
}

describe("NOM-02.d3 — Préstamos y descuentos autorizados (LFT Art. 110)", () => {
  it("aplica cuota autorizada, conserva saldo antes/después y emite deducción SAT", () => {
    // Sueldo quincenal $10,000 (1,000,000¢), SM quincenal 15*31,504 = 472,560¢
    // Excedente = 527,440¢; 30% = 158,232¢ -> cuota 50,000¢ entra completa
    const res = planPayrollLoanDeductions({
      loans: [makeLoan()],
      existingInstallments: [],
      companyId: COMPANY,
      userId: USER,
      periodStart: START,
      periodEnd: END,
      periodGrossPayCents: 1_000_000,
      periodMinimumWageCents: 472_560,
    });

    expect(res.status).toBe("AVAILABLE");
    expect(res.totalLoanDeductionsCents).toBe(50_000);
    expect(res.deductions).toHaveLength(1);
    expect(res.deductions[0]).toMatchObject({
      loanId: "loan-1",
      appliedCents: 50_000,
      balanceBeforeCents: 200_000,
      balanceAfterCents: 150_000,
      cappedByBalance: false,
      cappedByLegalLimit: false,
      alreadyAppliedInPeriod: false,
    });

    const desglose = construirDesgloseNomina({
      baseSalaryCents: 1_000_000,
      propinasCents: 0,
      loansBreakdown: res,
    });
    expect(desglose.desgloseDeducciones.find((d) => d.deductionTypeCode === "004")).toMatchObject({
      amount: 50_000,
    });
  });

  it("repetir el mismo período NO cobra dos veces ni vuelve a reducir el saldo", () => {
    const existing: PayrollLoanInstallmentRecord[] = [
      {
        id: "inst-1",
        companyId: COMPANY,
        loanId: "loan-1",
        userId: USER,
        periodStart: START,
        periodEnd: END,
        scheduledCents: 50_000,
        appliedCents: 50_000,
        balanceBeforeCents: 200_000,
        balanceAfterCents: 150_000,
        status: "APPLIED",
      },
    ];

    const res = planPayrollLoanDeductions({
      loans: [makeLoan({ remainingBalanceCents: 150_000 })],
      existingInstallments: existing,
      companyId: COMPANY,
      userId: USER,
      periodStart: START,
      periodEnd: END,
      periodGrossPayCents: 1_000_000,
      periodMinimumWageCents: 472_560,
    });

    expect(res.totalLoanDeductionsCents).toBe(0);
    expect(res.skippedAlreadyChargedCount).toBe(1);
    expect(res.deductions[0]).toMatchObject({
      appliedCents: 0,
      balanceBeforeCents: 150_000,
      balanceAfterCents: 150_000,
      alreadyAppliedInPeriod: true,
    });
  });

  it("topa al saldo restante en la última cuota y respeta tope legal 30% sobre excedente del SM (LFT Art. 110)", () => {
    // Caso 1: saldo restante menor a la cuota programada
    const lastPayment = planPayrollLoanDeductions({
      loans: [makeLoan({ remainingBalanceCents: 20_000, installmentCents: 50_000 })],
      existingInstallments: [],
      companyId: COMPANY,
      userId: USER,
      periodStart: START,
      periodEnd: END,
      periodGrossPayCents: 1_000_000,
      periodMinimumWageCents: 472_560,
    });
    expect(lastPayment.deductions[0]).toMatchObject({
      appliedCents: 20_000,
      balanceAfterCents: 0,
      cappedByBalance: true,
    });

    // Caso 2: excedente pequeño sobre SM -> tope 30% recorta la cuota de préstamo empresa
    // Gross 572,560 - SM 472,560 = 100,000 excedente -> 30% = 30,000 máximo
    const capped = planPayrollLoanDeductions({
      loans: [makeLoan({ installmentCents: 50_000, remainingBalanceCents: 200_000 })],
      existingInstallments: [],
      companyId: COMPANY,
      userId: USER,
      periodStart: START,
      periodEnd: END,
      periodGrossPayCents: 572_560,
      periodMinimumWageCents: 472_560,
    });
    expect(capped.legalExcessCapCents).toBe(30_000);
    expect(capped.deductions[0]).toMatchObject({
      appliedCents: 30_000,
      balanceAfterCents: 170_000,
      cappedByLegalLimit: true,
    });
  });

  it("préstamos cancelados, pausados, liquidados o de otra empresa nunca generan descuento", () => {
    const res = planPayrollLoanDeductions({
      loans: [
        makeLoan({ id: "l-can", status: "CANCELLED", cancelReason: "Condonación aprobada" }),
        makeLoan({ id: "l-pau", status: "PAUSED" }),
        makeLoan({ id: "l-paid", status: "PAID_OFF", remainingBalanceCents: 0 }),
        makeLoan({ id: "l-other", companyId: "cmp-other" }),
      ],
      existingInstallments: [],
      companyId: COMPANY,
      userId: USER,
      periodStart: START,
      periodEnd: END,
      periodGrossPayCents: 1_000_000,
      periodMinimumWageCents: 472_560,
    });

    expect(res.activeLoansCount).toBe(0);
    expect(res.totalLoanDeductionsCents).toBe(0);
    expect(res.deductions).toEqual([]);
  });
});
