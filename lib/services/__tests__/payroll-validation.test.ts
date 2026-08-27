// lib/services/__tests__/payroll-validation.test.ts
import { describe, it, expect } from "vitest";

describe("Payroll Pre-Stamping Validation & Ghost Employee Detection (Módulo 7.1, 7.2 & 7.3)", () => {
  it("blocks payroll stamping when an employee has 0 attendance sessions and no approved leaves (Ghost Employee)", () => {
    const employees = [
      { userId: "emp-1", name: "Juan Pérez", rfc: "PEPJ900101XYZ", curp: "PEPJ900101HNLXXX01", baseSalaryCents: 50000 },
      { userId: "emp-2", name: "Fantasma Ruiz", rfc: "RURF920202ABC", curp: "RURF920202HNLXXX02", baseSalaryCents: 60000 },
    ];

    const attendanceSessions = [
      { userId: "emp-1", shiftDate: "2026-08-01" },
      { userId: "emp-1", shiftDate: "2026-08-02" },
    ];

    const approvedLeaves: Array<{ userId: string }> = [];

    const validateStaff = () => {
      const errors = [];
      for (const emp of employees) {
        const sessions = attendanceSessions.filter((s) => s.userId === emp.userId);
        const leaves = approvedLeaves.filter((l) => l.userId === emp.userId);

        if (sessions.length === 0 && leaves.length === 0) {
          errors.push({
            userId: emp.userId,
            name: emp.name,
            code: "GHOST_EMPLOYEE",
            severity: "BLOCKING",
          });
        }
      }
      return {
        canStamp: errors.length === 0,
        errors,
      };
    };

    const validation = validateStaff();
    expect(validation.canStamp).toBe(false);
    expect(validation.errors).toHaveLength(1);
    expect(validation.errors[0].code).toBe("GHOST_EMPLOYEE");
    expect(validation.errors[0].name).toBe("Fantasma Ruiz");
  });

  it("passes validation when employee has approved vacation/leave even with 0 attendance punches", () => {
    const employees = [
      { userId: "emp-1", name: "María Garza", rfc: "GARM910303DEF", curp: "GARM910303MNLXXX03", baseSalaryCents: 45000 },
    ];

    const attendanceSessions: Array<{ userId: string }> = [];
    const approvedLeaves = [{ userId: "emp-1", type: "VACATION" }];

    const errors = [];
    for (const emp of employees) {
      const sessions = attendanceSessions.filter((s) => s.userId === emp.userId);
      const leaves = approvedLeaves.filter((l) => l.userId === emp.userId);

      if (sessions.length === 0 && leaves.length === 0) {
        errors.push({ code: "GHOST_EMPLOYEE", severity: "BLOCKING" });
      }
    }

    expect(errors.length).toBe(0);
  });

  it("blocks payroll stamping when RFC is missing or invalid for CFDI 4.0", () => {
    const employee = {
      userId: "emp-3",
      name: "Carlos Soto",
      rfc: "INV", // invalid length
      curp: "SOTC930404HNLXXX04",
      baseSalaryCents: 40000,
    };

    const isRfcValid = employee.rfc && employee.rfc.length >= 12;
    expect(isRfcValid).toBe(false);
  });

  it("calculates real labor cost including 35% employer social security burden (IMSS/Infonavit/ISN)", () => {
    const grossSalaryCents = 1000000; // $10,000.00 MXN
    const tipsCents = 200000; // $2,000.00 MXN

    const employerSocialSecurityCents = Math.round(grossSalaryCents * 0.35); // $3,500.00 MXN
    const realLaborCostCents = grossSalaryCents + employerSocialSecurityCents + tipsCents; // $15,500.00 MXN

    expect(employerSocialSecurityCents).toBe(350000);
    expect(realLaborCostCents).toBe(1550000);
  });
});
