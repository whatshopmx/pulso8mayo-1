import { describe, expect, it } from "vitest";
import { buildPayrollSnapshot, parsePayrollSnapshot, samePayrollSnapshot } from "@/lib/treasury/payroll-snapshot";

const companyId = "10000000-0000-4000-8000-000000000001";
const run = { id: "10000000-0000-4000-8000-000000000002", periodStart: "2026-11-01",
  periodEnd: "2026-11-15", status: "COMPLETED" };
const receipt = { payslipId: "10000000-0000-4000-8000-000000000003", employeeId: "employee-a",
  branchId: null, cfdiUuid: "10000000-0000-4000-8000-000000000004", cfdiStatus: "TIMBRADO",
  baseSalaryCents: 80000, holidayPayCents: 0, overtimePayCents: 0, aguinaldoCents: 0,
  propinasCents: 10000, totalPercepcionesCents: 90000, totalDeduccionesCents: 10000 };

describe("FC-15 immutable payroll allocation contract", () => {
  it("captures source identity, period, documented components and net without bank or personal records", () => {
    const snapshot = buildPayrollSnapshot(companyId, run, [receipt]);
    expect(snapshot).toMatchObject({ version: 1, companyId, payrollRunId: run.id,
      periodStart: run.periodStart, periodEnd: run.periodEnd, netCents: 80000, receipts: [receipt] });
    expect(parsePayrollSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it("rejects estimates, failed or incomplete runs and unstamped or cancelled receipts", () => {
    for (const status of ["DRAFT", "CALCULATED", "PROCESSING", "ERROR", "COMPLETED_WITH_ERRORS"]) {
      expect(() => buildPayrollSnapshot(companyId, { ...run, status }, [receipt])).toThrow();
    }
    for (const cfdiStatus of ["ERROR", "PENDIENTE", "CANCELADO", ""]) {
      expect(() => buildPayrollSnapshot(companyId, run, [{ ...receipt, cfdiStatus }])).toThrow();
    }
    expect(() => buildPayrollSnapshot(companyId, run, [])).toThrow();
  });

  it("rejects duplicate receipts, employees and stamped documents", () => {
    const other = { ...receipt, payslipId: "10000000-0000-4000-8000-000000000005",
      employeeId: "employee-b", cfdiUuid: "10000000-0000-4000-8000-000000000006" };
    for (const duplicate of [{ ...other, payslipId: receipt.payslipId },
      { ...other, employeeId: receipt.employeeId }, { ...other, cfdiUuid: receipt.cfdiUuid }]) {
      expect(() => buildPayrollSnapshot(companyId, run, [receipt, duplicate])).toThrow();
    }
  });

  it("detects changed employees and deductions even with an unchanged net total", () => {
    const original = buildPayrollSnapshot(companyId, run, [receipt]);
    const changedEmployee = buildPayrollSnapshot(companyId, run, [{ ...receipt, employeeId: "employee-b" }]);
    const changedAmounts = buildPayrollSnapshot(companyId, run, [{ ...receipt, baseSalaryCents: 81000,
      totalPercepcionesCents: 91000, totalDeduccionesCents: 11000 }]);
    expect(changedAmounts.netCents).toBe(original.netCents);
    expect(samePayrollSnapshot(original, changedAmounts)).toBe(false);
    expect(samePayrollSnapshot(original, changedEmployee)).toBe(false);
  });

  it("normalizes receipt ordering and protects declared net and calendar boundaries", () => {
    const other = { ...receipt, payslipId: "10000000-0000-4000-8000-000000000005",
      employeeId: "employee-b", cfdiUuid: "10000000-0000-4000-8000-000000000006" };
    const snapshot = buildPayrollSnapshot(companyId, run, [other, receipt]);
    expect(samePayrollSnapshot(snapshot, buildPayrollSnapshot(companyId, run, [receipt, other]))).toBe(true);
    expect(() => parsePayrollSnapshot({ ...snapshot, netCents: 1 })).toThrow();
    expect(() => buildPayrollSnapshot(companyId, { ...run, periodEnd: "2026-02-30" }, [receipt])).toThrow();
    expect(() => buildPayrollSnapshot(companyId, { ...run, periodEnd: "2026-10-31" }, [receipt])).toThrow();
    expect(() => buildPayrollSnapshot(companyId, run, [{ ...receipt, totalDeduccionesCents: 90001 }])).toThrow();
    expect(() => buildPayrollSnapshot(companyId, run, [{ ...receipt, propinasCents: 0 }])).toThrow();
  });
});
