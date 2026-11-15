import { describe, it, expect, vi } from "vitest";
import {
  validatePayrollPeriod,
  resolveContractSalaryForPeriod,
  isPayrollPeriodFrozen,
} from "../payroll-service";
import { calculatePayrollData } from "../compliance/payroll-calculator";
import { buildPayrollSnapshot, parsePayrollSnapshot } from "@/lib/treasury/payroll-snapshot";

describe("NOM-01: Contrato salarial, periodicidad, calendario y vigencias temporales", () => {
  describe("1. Periodicidad y Calendario (validatePayrollPeriod)", () => {
    it("valida un período regular de 15 días calendario correctamente", () => {
      const period = validatePayrollPeriod("2026-08-01", "2026-08-15");
      expect(period).toEqual({
        startDate: "2026-08-01",
        endDate: "2026-08-15",
        calendarDays: 15,
      });
    });

    it("valida un período semanal de 7 días calendario", () => {
      const period = validatePayrollPeriod("2026-08-01", "2026-08-07");
      expect(period.calendarDays).toBe(7);
    });

    it("rechaza un período invertido (startDate > endDate) con RangeError descriptivo", () => {
      expect(() => validatePayrollPeriod("2026-08-15", "2026-08-01")).toThrow(
        /Periodo de nómina inválido/i
      );
    });

    it("rechaza formatos de fecha inválidos", () => {
      expect(() => validatePayrollPeriod("fecha-invalida", "2026-08-15")).toThrow(
        /Periodo de nómina inválido/i
      );
    });
  });

  describe("2. Contrato salarial, moneda y vigencias (resolveContractSalaryForPeriod)", () => {
    const baseContract = {
      id: "contract-1",
      userId: "user-1",
      contractNumber: "CTR-2026-001",
      baseSalary: 50000, // $500.00 MXN diarios en centavos
      currency: "MXN",
      workRegime: "DAILY" as const,
      startDate: new Date("2025-01-01T00:00:00Z"),
      endDate: null,
      status: "ACTIVE",
    };

    it("calcula el sueldo base para un período completo de 15 días sin cambios salariales", () => {
      const res = resolveContractSalaryForPeriod({
        contract: baseContract,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-15",
      });

      expect(res.effectiveDaysInPeriod).toBe(15);
      expect(res.calendarDaysInPeriod).toBe(15);
      expect(res.isProrated).toBe(false);
      expect(res.dailySalaryCents).toBe(50000);
      expect(res.baseSalaryCents).toBe(750000); // 15 * 50,000¢ = $7,500.00 MXN
      expect(res.currency).toBe("MXN");
    });

    it("prorratea días si el empleado fue contratado a mitad del período (vigencia de inicio)", () => {
      const midContract = {
        ...baseContract,
        startDate: new Date("2026-08-10T00:00:00Z"), // Contratado el 10 de agosto
      };

      const res = resolveContractSalaryForPeriod({
        contract: midContract,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-15",
      });

      // Del 10 al 15 de agosto son 6 días efectivos
      expect(res.effectiveDaysInPeriod).toBe(6);
      expect(res.calendarDaysInPeriod).toBe(15);
      expect(res.isProrated).toBe(true);
      expect(res.baseSalaryCents).toBe(300000); // 6 * 50,000¢ = $3,000.00 MXN
    });

    it("prorratea días si el contrato terminó a mitad del período (vigencia de fin)", () => {
      const termContract = {
        ...baseContract,
        endDate: new Date("2026-08-05T00:00:00Z"), // Finalizó el 5 de agosto
      };

      const res = resolveContractSalaryForPeriod({
        contract: termContract,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-15",
      });

      // Del 1 al 5 de agosto son 5 días efectivos
      expect(res.effectiveDaysInPeriod).toBe(5);
      expect(res.calendarDaysInPeriod).toBe(15);
      expect(res.isProrated).toBe(true);
      expect(res.baseSalaryCents).toBe(250000); // 5 * 50,000¢ = $2,500.00 MXN
    });

    it("rechaza contrato con fecha de inicio posterior al período (0 días vigentes)", () => {
      const futureContract = {
        ...baseContract,
        startDate: new Date("2026-09-01T00:00:00Z"),
      };

      expect(() =>
        resolveContractSalaryForPeriod({
          contract: futureContract,
          periodStart: "2026-08-01",
          periodEnd: "2026-08-15",
        })
      ).toThrow(/no estuvo vigente durante el período/i);
    });

    it("rechaza contrato vencido antes del inicio del período", () => {
      const expiredContract = {
        ...baseContract,
        endDate: new Date("2026-07-31T00:00:00Z"),
      };

      expect(() =>
        resolveContractSalaryForPeriod({
          contract: expiredContract,
          periodStart: "2026-08-01",
          periodEnd: "2026-08-15",
        })
      ).toThrow(/no estuvo vigente durante el período/i);
    });

    it("rechaza contratos con monedas no soportadas (distintas de MXN)", () => {
      const usdContract = {
        ...baseContract,
        currency: "USD",
      };

      expect(() =>
        resolveContractSalaryForPeriod({
          contract: usdContract,
          periodStart: "2026-08-01",
          periodEnd: "2026-08-15",
        })
      ).toThrow(/Moneda no soportada.*USD/i);
    });

    it("rechaza contratos con salario base menor o igual a cero", () => {
      const zeroContract = {
        ...baseContract,
        baseSalary: 0,
      };

      expect(() =>
        resolveContractSalaryForPeriod({
          contract: zeroContract,
          periodStart: "2026-08-01",
          periodEnd: "2026-08-15",
        })
      ).toThrow(/salario base.*mayor a cero/i);
    });
  });

  describe("3. Vigencias de cambios salariales (Salary History)", () => {
    const contract = {
      id: "contract-1",
      userId: "user-1",
      contractNumber: "CTR-2026-001",
      baseSalary: 40000, // $400.00 MXN diarios iniciales
      currency: "MXN",
      workRegime: "DAILY" as const,
      startDate: new Date("2025-01-01T00:00:00Z"),
      endDate: null,
      status: "ACTIVE",
    };

    it("aplica aumento salarial efectivo a mitad del período de forma ponderada", () => {
      // Período 2026-08-01 a 2026-08-15 (15 días)
      // Aumento a 60,000¢ a partir del 8 de agosto
      // Días 1..7 (7 días) @ 40,000¢ = 280,000¢
      // Días 8..15 (8 días) @ 60,000¢ = 480,000¢
      // Total esperado = 760,000¢
      const history = [
        {
          id: "hist-1",
          contractId: "contract-1",
          previousSalary: 40000,
          newSalary: 60000,
          effectiveDate: new Date("2026-08-08T00:00:00Z"),
        },
      ];

      const res = resolveContractSalaryForPeriod({
        contract,
        salaryHistory: history,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-15",
      });

      expect(res.effectiveDaysInPeriod).toBe(15);
      expect(res.baseSalaryCents).toBe(760000);
      expect(res.dailySalaryCents).toBe(60000); // Salario diario al cierre del período
      expect(res.salaryChangesApplied).toBe(1);
    });

    it("un aumento salarial posterior al período NO altera el período previo", () => {
      // Período 2026-08-01 a 2026-08-15
      // Aumento a 80,000¢ con fecha efectiva 2026-08-20 (posterior al período)
      // Debe ignorarse completamente para el período del 1 al 15 de agosto
      const futureHistory = [
        {
          id: "hist-2",
          contractId: "contract-1",
          previousSalary: 40000,
          newSalary: 80000,
          effectiveDate: new Date("2026-08-20T00:00:00Z"),
        },
      ];

      const res = resolveContractSalaryForPeriod({
        contract,
        salaryHistory: futureHistory,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-15",
      });

      expect(res.effectiveDaysInPeriod).toBe(15);
      expect(res.baseSalaryCents).toBe(600000); // 15 * 40,000¢ = 600,000¢
      expect(res.dailySalaryCents).toBe(40000);
      expect(res.salaryChangesApplied).toBe(0);
    });
  });

  describe("4. Compatibilidad con FC-15 y snapshots inmutables", () => {
    it("los componentes salariales de NOM-01 cuadran con el contrato de reconocimiento y snapshot", () => {
      const contract = {
        id: "contract-1",
        userId: "user-1",
        contractNumber: "CTR-2026-001",
        baseSalary: 50000,
        currency: "MXN",
        startDate: new Date("2025-01-01"),
        endDate: null,
        status: "ACTIVE",
      };

      const res = resolveContractSalaryForPeriod({
        contract,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-15",
      });

      const holidayPayCents = 100000;
      const propinasCents = 50000;
      const totalPercepcionesCents = res.baseSalaryCents + holidayPayCents + propinasCents;
      const totalDeduccionesCents = 0;

      // Verificar que cumple con el schema estricto de snapshot de tesorería
      const run = {
        id: "11111111-1111-4111-8111-111111111111",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-15",
        status: "COMPLETED",
      };

      const receipt = {
        payslipId: "22222222-2222-4222-8222-222222222222",
        employeeId: "user-1",
        branchId: null,
        cfdiUuid: "33333333-3333-4333-8333-333333333333",
        cfdiStatus: "TIMBRADO",
        baseSalaryCents: res.baseSalaryCents,
        holidayPayCents,
        overtimePayCents: 0,
        aguinaldoCents: 0,
        propinasCents,
        totalPercepcionesCents,
        totalDeduccionesCents,
      };

      const snapshot = buildPayrollSnapshot("44444444-4444-4444-8444-444444444444", run, [receipt]);
      expect(snapshot.netCents).toBe(totalPercepcionesCents);
      expect(snapshot.receipts[0].baseSalaryCents).toBe(750000);
      expect(parsePayrollSnapshot(snapshot)).toBeDefined();
    });
  });

  describe("5. Períodos congelados e inmutabilidad frente a cambios salariales posteriores", () => {
    it("isPayrollPeriodFrozen identifica correctamente corridas completadas", async () => {
      const mockDbCompleted = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: "run-completed-1" }]),
            }),
          }),
        }),
      } as any;

      const frozen = await isPayrollPeriodFrozen(
        "company-1",
        "2026-08-01",
        "2026-08-15",
        mockDbCompleted
      );
      expect(frozen).toBe(true);

      const mockDbEmpty = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as any;

      const notFrozen = await isPayrollPeriodFrozen(
        "company-1",
        "2026-08-01",
        "2026-08-15",
        mockDbEmpty
      );
      expect(notFrozen).toBe(false);
    });

    it("un cambio salarial posterior no altera los recibos de un período congelado previo", () => {
      // 1. Simulación de período congelado (Quincena 1 - Agosto 2026)
      const frozenPeriodStart = "2026-08-01";
      const frozenPeriodEnd = "2026-08-15";
      const initialContract = {
        id: "ctr-frozen",
        userId: "emp-frozen",
        contractNumber: "CTR-001",
        baseSalary: 45000, // $450 diarios
        currency: "MXN",
        startDate: new Date("2026-01-01"),
        endDate: null,
      };

      const frozenResolution = resolveContractSalaryForPeriod({
        contract: initialContract,
        periodStart: frozenPeriodStart,
        periodEnd: frozenPeriodEnd,
      });

      // Recibo congelado emitido en su momento
      const frozenPayslip = {
        runId: "run-aug-1",
        status: "COMPLETED",
        baseSalaryCents: frozenResolution.baseSalaryCents, // 15 * 45,000 = 675,000¢
        totalPercepcionesCents: frozenResolution.baseSalaryCents,
      };

      // 2. Posteriormente, en Septiembre, el empleado recibe un aumento sustancial a $700 diarios
      const updatedContract = {
        ...initialContract,
        baseSalary: 70000, // Modificado en el contrato actual
      };
      const subsequentSalaryHistory = [
        {
          id: "hist-sep",
          contractId: "ctr-frozen",
          previousSalary: 45000,
          newSalary: 70000,
          effectiveDate: new Date("2026-09-01T00:00:00Z"),
        },
      ];

      // 3. Verificamos que el recibo congelado mantiene su valor histórico
      expect(frozenPayslip.baseSalaryCents).toBe(675000);

      // 4. Si se evalúa retrospectivamente el período de agosto con el historial salarial completo,
      // el salario de agosto sigue siendo exactamente el vigente en agosto ($450), no el posterior ($700)
      const reevaluatedAug = resolveContractSalaryForPeriod({
        contract: updatedContract,
        salaryHistory: subsequentSalaryHistory,
        periodStart: frozenPeriodStart,
        periodEnd: frozenPeriodEnd,
      });

      expect(reevaluatedAug.baseSalaryCents).toBe(675000);
      expect(reevaluatedAug.dailySalaryCents).toBe(45000);
      expect(reevaluatedAug.salaryChangesApplied).toBe(0);
    });
  });

  describe("6. Compliance y Exportación (calculatePayrollData)", () => {
    it("rechaza períodos con fechas invertidas", async () => {
      await expect(
        calculatePayrollData({
          companyId: "comp-1",
          startDate: "2026-08-15",
          endDate: "2026-08-01",
        })
      ).rejects.toThrow(/Periodo de nómina inválido/i);
    });
  });
});
