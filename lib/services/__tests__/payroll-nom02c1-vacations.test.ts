import { describe, it, expect } from "vitest";
import {
  resolveVacationsForPeriod,
  resolveLeavesForPeriod,
  resolveAttendanceForPeriod,
  construirDesgloseNomina,
  validatePayrollPeriod,
} from "../payroll-service";

describe("NOM-02.c1: Vacaciones, permisos con/sin goce y prima vacacional (LFT Arts. 76, 79, 80 & LISR Art. 93)", () => {
  const baseUserId = "usr-worker-nom02c1";
  const baseCompanyId = "cmp-horeca-nom02c1";
  const periodStart = "2026-05-01";
  const periodEnd = "2026-05-15"; // Quincena de 15 días calendario
  const dailySalaryCents = 50000; // $500.00 MXN diarios

  describe("1. Validación de período de nómina", () => {
    it("valida período quincenal de 15 días calendario", () => {
      const period = validatePayrollPeriod(periodStart, periodEnd);
      expect(period.calendarDays).toBe(15);
      expect(period.startDate).toBe("2026-05-01");
      expect(period.endDate).toBe("2026-05-15");
    });

    it("rechaza período invertido con RangeError", () => {
      expect(() => validatePayrollPeriod("2026-05-15", "2026-05-01")).toThrow(
        /Periodo de nómina inválido: la fecha de inicio no puede ser posterior/i
      );
    });
  });

  describe("2. Case 1: Normal con saldo suficiente (LFT Arts. 76 & 80, prima mínima 25%)", () => {
    it("calcula 6 días de vacaciones aprobados con prima vacacional del 25% y saldo remanente", async () => {
      // 6 días de vacaciones autorizadas (Lunes 4 a Sábado 9 de mayo)
      const vacationRequests = [
        {
          id: "vac-req-1",
          startDate: "2026-05-04",
          endDate: "2026-05-09",
          totalDays: 6,
          status: "APPROVED",
        },
      ];
      // Saldo disponible de 12 días acumulados
      const vacationAccruals = [
        { year: 2026, daysBalance: 12, daysAccrued: 12, daysTaken: 0 },
      ];

      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        vacationRequests,
        vacationAccruals,
      });

      expect(res.hasVacations).toBe(true);
      expect(res.vacationDaysTaken).toBe(6);
      expect(res.vacationDaysEligible).toBe(6);
      expect(res.vacationDaysExceeded).toBe(0);
      expect(res.vacationAvailableBalance).toBe(12);
      expect(res.vacationRemainingBalance).toBe(6);
      expect(res.justification).toBe("LFT_ARTS_76_80");
      expect(res.vacationBonusPercent).toBe(25);
      // Salario base de vacaciones: 6 * 50,000 = 300,000¢ ($3,000.00 MXN)
      expect(res.vacationBasePayCents).toBe(300000);
      // Prima vacacional 25%: round(300,000 * 25 / 100) = 75,000¢ ($750.00 MXN)
      expect(res.vacationPrimeCents).toBe(75000);
      expect(res.approvedRequestsCount).toBe(1);
      expect(res.rejectedRequestsCount).toBe(0);
      expect(res.pendingRequestsCount).toBe(0);

      // Fiscal SAT: Concepto 021 exento bajo 15 UMA (169,710¢)
      const desglose = construirDesgloseNomina({
        baseSalaryCents: 750000,
        propinasCents: 0,
        vacationPrimeCents: res.vacationPrimeCents,
        vacationBreakdown: res,
      });
      const nodo021 = desglose.desglosePercepciones.find((p) => p.code === "021");
      expect(nodo021).toBeDefined();
      expect(nodo021?.earningTypeCode).toBe("021");
      expect(nodo021?.concept).toContain("Prima vacacional");
      expect(nodo021?.taxedAmount).toBe(0);
      expect(nodo021?.exemptAmount).toBe(75000);
      expect(nodo021!.taxedAmount + nodo021!.exemptAmount).toBe(75000);
    });
  });

  describe("3. Case 2: Saldo parcial (días solicitados superan el saldo disponible)", () => {
    it("calcula prima únicamente sobre días con saldo y reporta días excedidos", async () => {
      // Solicita 6 días pero sólo le quedan 4 días de saldo
      const vacationRequests = [
        {
          id: "vac-req-partial",
          startDate: "2026-05-04",
          endDate: "2026-05-09",
          totalDays: 6,
          status: "APPROVED",
        },
      ];
      const vacationAccruals = [
        { year: 2026, daysBalance: 4, daysAccrued: 12, daysTaken: 8 },
      ];

      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        vacationRequests,
        vacationAccruals,
      });

      expect(res.hasVacations).toBe(true);
      expect(res.vacationDaysTaken).toBe(6);
      expect(res.vacationDaysEligible).toBe(4);
      expect(res.vacationDaysExceeded).toBe(2);
      expect(res.vacationAvailableBalance).toBe(4);
      expect(res.vacationRemainingBalance).toBe(0);
      expect(res.justification).toBe("EXCEEDED_VACATION_BALANCE");
      // Salario elegible: 4 * 50,000 = 200,000¢
      expect(res.vacationBasePayCents).toBe(200000);
      // Prima vacacional: round(200,000 * 25 / 100) = 50,000¢ ($500.00 MXN)
      expect(res.vacationPrimeCents).toBe(50000);

      const desglose = construirDesgloseNomina({
        baseSalaryCents: 750000,
        propinasCents: 0,
        vacationPrimeCents: res.vacationPrimeCents,
      });
      const nodo021 = desglose.desglosePercepciones.find((p) => p.code === "021");
      expect(nodo021).toBeDefined();
      expect(nodo021?.taxedAmount).toBe(0);
      expect(nodo021?.exemptAmount).toBe(50000);
    });
  });

  describe("4. Case 3: Sin saldo acumulado (saldo = 0)", () => {
    it("solicitud autorizada sin saldo genera 0 prima y días excedidos", async () => {
      const vacationRequests = [
        {
          id: "vac-req-nosaldo",
          startDate: "2026-05-04",
          endDate: "2026-05-08",
          totalDays: 5,
          status: "APPROVED",
        },
      ];
      const vacationAccruals = [
        { year: 2026, daysBalance: 0, daysAccrued: 12, daysTaken: 12 },
      ];

      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        vacationRequests,
        vacationAccruals,
      });

      expect(res.hasVacations).toBe(true);
      expect(res.vacationDaysTaken).toBe(5);
      expect(res.vacationDaysEligible).toBe(0);
      expect(res.vacationDaysExceeded).toBe(5);
      expect(res.vacationAvailableBalance).toBe(0);
      expect(res.vacationRemainingBalance).toBe(0);
      expect(res.justification).toBe("EXCEEDED_VACATION_BALANCE");
      expect(res.vacationBasePayCents).toBe(0);
      expect(res.vacationPrimeCents).toBe(0);

      // SAT: con 0¢ no se emite concepto 021
      const desglose = construirDesgloseNomina({
        baseSalaryCents: 750000,
        propinasCents: 0,
        vacationPrimeCents: res.vacationPrimeCents,
      });
      const nodo021 = desglose.desglosePercepciones.find((p) => p.code === "021");
      expect(nodo021).toBeUndefined();
    });
  });

  describe("5. Case 4: Ausencia total de datos (regla anti-inferencias)", () => {
    it("ausencia de datos produce 0 prima vacacional y no genera falta injustificada", async () => {
      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        vacationRequests: [],
        vacationAccruals: [],
      });

      expect(res.hasVacations).toBe(false);
      expect(res.vacationDaysTaken).toBe(0);
      expect(res.vacationDaysEligible).toBe(0);
      expect(res.vacationDaysExceeded).toBe(0);
      expect(res.vacationPrimeCents).toBe(0);
      expect(res.justification).toBe("SIN_VACACIONES");

      // Verificación en resolveAttendanceForPeriod: no crea faltas automáticas
      const attendance = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        sessions: [],
        vacations: [],
        leaves: [],
      });
      expect(attendance.unpaidAbsenceDays).toBe(0);
      expect(attendance.payableDays).toBe(15); // Sueldo base íntegro
      expect(attendance.vacationDays).toBe(0);
    });
  });

  describe("6. Case 5 & 6: Solicitud rechazada o pendiente", () => {
    it("solicitud rechazada no genera pago de prima y se contabiliza en rejectedRequestsCount", async () => {
      const vacationRequests = [
        {
          id: "vac-req-rej",
          startDate: "2026-05-04",
          endDate: "2026-05-08",
          totalDays: 5,
          status: "REJECTED",
          rejectionReason: "Temporada alta, cobertura insuficiente",
        },
      ];
      const vacationAccruals = [{ year: 2026, daysBalance: 10 }];

      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        vacationRequests,
        vacationAccruals,
      });

      expect(res.hasVacations).toBe(false);
      expect(res.vacationDaysTaken).toBe(0);
      expect(res.vacationDaysEligible).toBe(0);
      expect(res.vacationPrimeCents).toBe(0);
      expect(res.justification).toBe("SIN_VACACIONES");
      expect(res.rejectedRequestsCount).toBe(1);
      expect(res.approvedRequestsCount).toBe(0);
    });

    it("solicitud en estado PENDING no genera pago y se contabiliza en pendingRequestsCount", async () => {
      const vacationRequests = [
        {
          id: "vac-req-pend",
          startDate: "2026-05-04",
          endDate: "2026-05-08",
          totalDays: 5,
          status: "PENDING",
        },
      ];
      const vacationAccruals = [{ year: 2026, daysBalance: 10 }];

      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        vacationRequests,
        vacationAccruals,
      });

      expect(res.hasVacations).toBe(false);
      expect(res.vacationDaysTaken).toBe(0);
      expect(res.vacationDaysEligible).toBe(0);
      expect(res.vacationPrimeCents).toBe(0);
      expect(res.justification).toBe("SIN_VACACIONES");
      expect(res.pendingRequestsCount).toBe(1);
    });
  });

  describe("7. Case 7 & 8: Permisos con goce vs permisos sin goce (resolveLeavesForPeriod)", () => {
    it("permiso con goce (paternidad 10 días, isPaid: true) mantiene 100% sueldo base y 0 prima", async () => {
      const leaveRequests = [
        {
          id: "leave-pat-1",
          leaveTypeName: "PATERNITY",
          startDate: "2026-05-02",
          endDate: "2026-05-11",
          totalDays: 10,
          status: "APPROVED",
          isPaid: true,
        },
      ];

      const leaveBreakdown = await resolveLeavesForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        leaveRequests,
      });

      expect(leaveBreakdown.hasPaidLeave).toBe(true);
      expect(leaveBreakdown.hasUnpaidLeave).toBe(false);
      expect(leaveBreakdown.paidLeaveDays).toBe(10);
      expect(leaveBreakdown.unpaidLeaveDays).toBe(0);
      expect(leaveBreakdown.details).toHaveLength(1);
      expect(leaveBreakdown.details[0].isPaid).toBe(true);

      // Verificación en resolveAttendanceForPeriod: no descuenta sueldo
      const attendance = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        leaves: leaveRequests,
        sessions: [],
      });
      expect(attendance.unpaidAbsenceDays).toBe(0);
      expect(attendance.payableDays).toBe(15);
      expect(attendance.paidLeaveDays).toBe(10);
      expect(attendance.vacationDays).toBe(0);
    });

    it("permiso sin goce (3 días, isPaid: false) descuenta exactamente 3 días del sueldo base", async () => {
      const leaveRequests = [
        {
          id: "leave-unpaid-1",
          leaveTypeName: "PERSONAL_UNPAID",
          startDate: "2026-05-04",
          endDate: "2026-05-06",
          totalDays: 3,
          status: "APPROVED",
          isPaid: false,
        },
      ];

      const leaveBreakdown = await resolveLeavesForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        leaveRequests,
      });

      expect(leaveBreakdown.hasPaidLeave).toBe(false);
      expect(leaveBreakdown.hasUnpaidLeave).toBe(true);
      expect(leaveBreakdown.paidLeaveDays).toBe(0);
      expect(leaveBreakdown.unpaidLeaveDays).toBe(3);

      // En asistencia: genera 3 días de falta no pagada
      const attendance = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        leaves: leaveRequests,
        sessions: [],
      });
      expect(attendance.unpaidAbsenceDays).toBe(3);
      expect(attendance.payableDays).toBe(12); // 15 - 3 = 12 días
      expect(attendance.paidLeaveDays).toBe(0);
    });
  });

  describe("8. Case 9: Tope de exención fiscal 15 UMA (LISR Art. 93 Frac. XIV)", () => {
    it("topa exención fiscal a 169,710¢ en 2026 y grava el excedente para salarios altos", async () => {
      // Salario diario de alta dirección: $2,500.00 MXN = 250,000¢
      const executiveSalaryCents = 250000;
      // 10 días de vacaciones autorizadas
      const vacationRequests = [
        {
          id: "vac-exec-1",
          startDate: "2026-05-01",
          endDate: "2026-05-10",
          totalDays: 10,
          status: "APPROVED",
        },
      ];
      const vacationAccruals = [{ year: 2026, daysBalance: 20 }];

      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents: executiveSalaryCents,
        vacationRequests,
        vacationAccruals,
      });

      expect(res.vacationDaysEligible).toBe(10);
      // Salario base de vacaciones: 10 * 250,000 = 2,500,000¢ ($25,000.00 MXN)
      expect(res.vacationBasePayCents).toBe(2500000);
      // Prima vacacional 25%: round(2,500,000 * 25 / 100) = 625,000¢ ($6,250.00 MXN)
      expect(res.vacationPrimeCents).toBe(625000);

      // Desglose fiscal CFDI: UMA 2026 diaria = 11,314¢. 15 UMAs = 169,710¢.
      const desglose = construirDesgloseNomina({
        baseSalaryCents: 3750000,
        propinasCents: 0,
        vacationPrimeCents: res.vacationPrimeCents,
      });
      const nodo021 = desglose.desglosePercepciones.find((p) => p.code === "021");
      expect(nodo021).toBeDefined();
      expect(nodo021?.exemptAmount).toBe(169710); // Tope legal 15 UMAs
      expect(nodo021?.taxedAmount).toBe(455290); // 625,000 - 169,710 = 455,290¢
      // Invariante fiscal fundamental SAT: gravado + exento === total percepción
      expect(nodo021!.taxedAmount + nodo021!.exemptAmount).toBe(625000);
    });
  });

  describe("9. Case 10: Deduplicación e idempotencia con solicitudes solapadas", () => {
    it("solicitudes aprobadas solapadas cuentan cada fecha civil solo una vez", async () => {
      // Dos solicitudes aprobadas que comparten fechas:
      // Solicitud 1: 2026-05-04 al 2026-05-08 (5 días: 4, 5, 6, 7, 8)
      // Solicitud 2: 2026-05-06 al 2026-05-10 (5 días: 6, 7, 8, 9, 10)
      // Unión: 4, 5, 6, 7, 8, 9, 10 = 7 días únicos
      const vacationRequests = [
        {
          id: "vac-overlap-1",
          startDate: "2026-05-04",
          endDate: "2026-05-08",
          totalDays: 5,
          status: "APPROVED",
        },
        {
          id: "vac-overlap-2",
          startDate: "2026-05-06",
          endDate: "2026-05-10",
          totalDays: 5,
          status: "APPROVED",
        },
      ];
      const vacationAccruals = [{ year: 2026, daysBalance: 15 }];

      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        vacationRequests,
        vacationAccruals,
      });

      expect(res.vacationDaysTaken).toBe(7);
      expect(res.vacationDaysEligible).toBe(7);
      expect(res.vacationDaysExceeded).toBe(0);
      expect(res.vacationBasePayCents).toBe(7 * 50000); // 350,000¢
      expect(res.vacationPrimeCents).toBe(Math.round((350000 * 25) / 100)); // 87,500¢
    });
  });

  describe("10. Case 11: Prestación contractual superior (Prima 50% vs 25% base)", () => {
    it("respeta porcentaje contractual superior (ej. 50%) conforme a contrato", async () => {
      const vacationRequests = [
        {
          id: "vac-bonus-50",
          startDate: "2026-05-04",
          endDate: "2026-05-09",
          totalDays: 6,
          status: "APPROVED",
        },
      ];
      const vacationAccruals = [{ year: 2026, daysBalance: 12 }];

      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        vacationBonusPercent: 50, // Prestación contractual superior
        vacationRequests,
        vacationAccruals,
      });

      expect(res.vacationBonusPercent).toBe(50);
      expect(res.vacationDaysEligible).toBe(6);
      expect(res.vacationBasePayCents).toBe(300000); // 6 * 50,000¢
      // Prima vacacional 50%: round(300,000 * 50 / 100) = 150,000¢ ($1,500.00 MXN)
      expect(res.vacationPrimeCents).toBe(150000);

      const desglose = construirDesgloseNomina({
        baseSalaryCents: 750000,
        propinasCents: 0,
        vacationPrimeCents: res.vacationPrimeCents,
      });
      const nodo021 = desglose.desglosePercepciones.find((p) => p.code === "021");
      expect(nodo021).toBeDefined();
      expect(nodo021?.exemptAmount).toBe(150000); // Menor al tope de 169,710¢
      expect(nodo021?.taxedAmount).toBe(0);
    });

    it("no permite porcentaje inferior al mínimo legal del 25% (LFT Art. 80)", async () => {
      const vacationRequests = [
        {
          startDate: "2026-05-04",
          endDate: "2026-05-05",
          totalDays: 2,
          status: "APPROVED",
        },
      ];
      const vacationAccruals = [{ year: 2026, daysBalance: 10 }];

      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        vacationBonusPercent: 10, // Intento de pagar menos del 25%
        vacationRequests,
        vacationAccruals,
      });

      // Aplica automáticamente el mínimo legal de 25%
      expect(res.vacationBonusPercent).toBe(25);
      expect(res.vacationPrimeCents).toBe(Math.round((100000 * 25) / 100)); // 25,000¢
    });
  });

  describe("11. Case 12: Saldo resuelto desde leaveBalances (fallback secundario)", () => {
    it("resuelve saldo correctamente cuando se provee leaveBalances en lugar de vacationAccruals", async () => {
      const vacationRequests = [
        {
          startDate: "2026-05-04",
          endDate: "2026-05-08",
          totalDays: 5,
          status: "APPROVED",
        },
      ];
      const leaveBalances = [{ balance: 8 }];

      const res = await resolveVacationsForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        vacationRequests,
        leaveBalances,
      });

      expect(res.vacationDaysTaken).toBe(5);
      expect(res.vacationDaysEligible).toBe(5);
      expect(res.vacationDaysExceeded).toBe(0);
      expect(res.vacationAvailableBalance).toBe(8);
      expect(res.vacationRemainingBalance).toBe(3);
      expect(res.justification).toBe("LFT_ARTS_76_80");
      expect(res.vacationPrimeCents).toBe(Math.round((250000 * 25) / 100)); // 62,500¢
    });
  });
});
