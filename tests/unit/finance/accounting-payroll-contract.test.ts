import { describe, expect, it } from "vitest";
import { payrollPlan } from "@/lib/services/accounting/payroll-contract";
import { MAX_CENTS, totalsOf } from "@/lib/services/accounting/amounts";

const recognition = {
  kind: "RECOGNITION", baseSalaryCents: 70000, holidayPayCents: 5000,
  overtimePayCents: 3000, aguinaldoCents: 2000, propinasCents: 10000,
  totalPercepcionesCents: 90000, totalDeduccionesCents: 10000,
} as const;

describe("FC-15 payroll amount contract", () => {
  it("recognizes salary once and clears tips already owed instead of expensing them again", () => {
    const lines = payrollPlan(recognition);
    expect(lines).toEqual([
      { role: "PAYROLL_EXPENSE", debitCents: 80000, creditCents: 0 },
      { role: "TIPS_PAYABLE", debitCents: 10000, creditCents: 0 },
      { role: "PAYROLL_PAYABLE", debitCents: 0, creditCents: 80000 },
      { role: "PAYROLL_DEDUCTIONS", debitCents: 0, creditCents: 10000 },
    ]);
    expect(totalsOf(lines)).toEqual({ debitCents: 90000, creditCents: 90000, balanced: true });
  });

  it("settles partial net payroll without recognizing another expense", () => {
    expect(payrollPlan({ kind: "PAYMENT", amountCents: 30000, netCents: 80000, paidCents: 20000 })).toEqual([
      { role: "PAYROLL_PAYABLE", debitCents: 30000, creditCents: 0 },
      { role: "PAYMENT_SOURCE", debitCents: 0, creditCents: 30000 },
    ]);
    expect(() => payrollPlan({ kind: "PAYMENT", amountCents: 60001, netCents: 80000, paidCents: 20000 })).toThrow(/saldo/i);
    expect(() => payrollPlan({ kind: "PAYMENT", amountCents: 1, netCents: 80000, paidCents: 80001 })).toThrow(/saldo/i);
  });

  it("supports fully withheld salary and tips-only settlements without zero lines", () => {
    const withheld = payrollPlan({ ...recognition, totalDeduccionesCents: 90000 });
    expect(withheld.some(line => line.role === "PAYROLL_PAYABLE")).toBe(false);
    expect(totalsOf(withheld).balanced).toBe(true);
    expect(payrollPlan({ ...recognition, baseSalaryCents: 0, holidayPayCents: 0,
      overtimePayCents: 0, aguinaldoCents: 0, totalPercepcionesCents: 10000, totalDeduccionesCents: 0 })).toEqual([
      { role: "TIPS_PAYABLE", debitCents: 10000, creditCents: 0 },
      { role: "PAYROLL_PAYABLE", debitCents: 0, creditCents: 10000 },
    ]);
  });

  it("rejects inconsistent documented components and deductions greater than gross", () => {
    expect(() => payrollPlan({ ...recognition, totalPercepcionesCents: 90001 })).toThrow(/percepciones/i);
    expect(() => payrollPlan({ ...recognition, totalDeduccionesCents: 90001 })).toThrow(/deducciones/i);
    expect(() => payrollPlan({ ...recognition, baseSalaryCents: MAX_CENTS })).toThrow();
  });

  it("rejects missing, fractional, negative and unsafe cent amounts on both paths", () => {
    for (const value of [null, undefined, -1, 0.5, NaN, Infinity, MAX_CENTS + 1]) {
      expect(() => payrollPlan({ ...recognition, propinasCents: value as number })).toThrow();
      expect(() => payrollPlan({ kind: "PAYMENT", amountCents: value as number, netCents: 80000, paidCents: 0 })).toThrow();
    }
    expect(() => payrollPlan({ kind: "PAYMENT", amountCents: 0, netCents: 80000, paidCents: 0 })).toThrow();
    expect(() => payrollPlan({ ...recognition, baseSalaryCents: 0, holidayPayCents: 0,
      overtimePayCents: 0, aguinaldoCents: 0, propinasCents: 0,
      totalPercepcionesCents: 0, totalDeduccionesCents: 0 })).toThrow();
  });
});
