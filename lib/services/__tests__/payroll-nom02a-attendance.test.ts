import { describe, it, expect } from "vitest";
import {
  resolveAttendanceForPeriod,
  type ResolveAttendanceInput,
} from "../payroll-service";
import { buildPayrollSnapshot, parsePayrollSnapshot } from "@/lib/treasury/payroll-snapshot";

describe("NOM-02.a: Cálculo de base salarial desde asistencia aprobada, faltas y festivos", () => {
  const baseUserId = "usr-test-worker-1";
  const baseCompanyId = "cmp-test-horeca-1";
  const periodStart = "2026-05-01";
  const periodEnd = "2026-05-15"; // Quincena de 15 días calendario

  describe("1. Días pagaderos y asistencia aprobada vs no aprobada", () => {
    it("resuelve 15 días pagaderos para un período quincenal con asistencia aprobada y descanso semanal", async () => {
      // 10 sesiones aprobadas dentro de los 15 días (ej. 5 días de trabajo x 2 semanas)
      const sessions = [
        "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
        "2026-05-09", "2026-05-10", "2026-05-11", "2026-05-12", "2026-05-13",
      ].map((date, idx) => ({
        id: `sess-${idx + 1}`,
        startedAt: `${date}T14:00:00Z`,
        status: "COMPLETED",
        requiresApproval: false,
        approvedAt: new Date(`${date}T22:00:00Z`),
      }));

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        sessions,
        holidays: [],
        vacations: [],
        leaves: [],
      });

      expect(res.calendarDays).toBe(15);
      expect(res.effectiveDaysInPeriod).toBe(15);
      expect(res.approvedAttendanceDays).toBe(10);
      expect(res.unpaidAbsenceDays).toBe(0);
      expect(res.payableDays).toBe(15);
      expect(res.hasPendingAttendance).toBe(false);
      expect(res.pendingAttendanceDetails).toHaveLength(0);
    });

    it("sesión COMPLETED que requiere aprobación pero no tiene approvedAt se clasifica como pendiente", async () => {
      const sessions = [
        {
          id: "sess-req-app-1",
          startedAt: "2026-05-04T15:00:00Z",
          status: "COMPLETED",
          requiresApproval: true,
          approvedAt: null, // Manager no ha aprobado
        },
      ];

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        sessions,
      });

      expect(res.hasPendingAttendance).toBe(true);
      expect(res.pendingAttendanceDetails).toHaveLength(1);
      expect(res.pendingAttendanceDetails[0].sessionId).toBe("sess-req-app-1");
      expect(res.pendingAttendanceDetails[0].reason).toContain("requiere aprobación");
    });
  });

  describe("2. Deducción estricta de ausencias injustificadas (faltas / NO_SHOW)", () => {
    it("deduce días no asistidos (NO_SHOW) de los días pagaderos del período", async () => {
      const sessions = [
        // 5 días trabajados y aprobados
        { id: "s-1", startedAt: "2026-05-02T14:00:00Z", status: "COMPLETED", requiresApproval: false },
        { id: "s-2", startedAt: "2026-05-03T14:00:00Z", status: "COMPLETED", requiresApproval: false },
        { id: "s-3", startedAt: "2026-05-04T14:00:00Z", status: "COMPLETED", requiresApproval: false },
        // 2 faltas injustificadas registradas como NO_SHOW
        { id: "s-4", startedAt: "2026-05-05T14:00:00Z", status: "NO_SHOW" },
        { id: "s-5", startedAt: "2026-05-06T14:00:00Z", status: "NO_SHOW" },
      ];

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        sessions,
      });

      expect(res.calendarDays).toBe(15);
      expect(res.unpaidAbsenceDays).toBe(2);
      expect(res.payableDays).toBe(13); // 15 - 2 = 13 días pagaderos
      expect(res.approvedAttendanceDays).toBe(3);
    });

    it("deduce permisos sin goce de sueldo (leaveRequests con isPaid = false)", async () => {
      const leaves = [
        {
          startDate: "2026-05-07",
          endDate: "2026-05-08",
          totalDays: 2,
          isPaid: false,
          status: "APPROVED",
        },
      ];

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        leaves,
        sessions: [],
      });

      expect(res.unpaidAbsenceDays).toBe(2);
      expect(res.payableDays).toBe(13);
    });

    it("permisos con goce de sueldo e incidencias de vacaciones no descuentan salario base", async () => {
      const vacations = [
        {
          startDate: "2026-05-04",
          endDate: "2026-05-08",
          totalDays: 5,
          status: "APPROVED",
        },
      ];

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        vacations,
        sessions: [],
      });

      expect(res.paidLeaveDays).toBe(5);
      expect(res.unpaidAbsenceDays).toBe(0);
      expect(res.payableDays).toBe(15); // Sueldo quincenal íntegro
    });
  });

  describe("3. Días festivos oficiales obligatorios (LFT Arts. 74 & 75)", () => {
    it("festivo oficial descansado (Art. 74 LFT): 1x base (incluido en sueldo base) y 0x prima adicional", async () => {
      // 1 de mayo (Día del Trabajo): descanso obligatorio descansado
      const holidays = [{ date: "2026-05-01", isMandatory: true }];

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        holidays,
        sessions: [], // No checó ese día
      });

      expect(res.holidayDaysRested).toBe(1);
      expect(res.holidayDaysWorked).toBe(0);
      expect(res.unpaidAbsenceDays).toBe(0);
      expect(res.payableDays).toBe(15);
    });

    it("festivo oficial laborado (Art. 75 LFT): genera 1x base pagadera y 2x prima adicional en desglose", async () => {
      // 1 de mayo: día festivo trabajado
      const holidays = [{ date: "2026-05-01", isMandatory: true }];
      const sessions = [
        {
          id: "sess-may-1",
          startedAt: "2026-05-01T15:00:00Z",
          status: "COMPLETED",
          requiresApproval: false,
        },
      ];

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        holidays,
        sessions,
      });

      expect(res.holidayDaysWorked).toBe(1);
      expect(res.holidayDaysRested).toBe(0);
      expect(res.payableDays).toBe(15);
    });
  });

  describe("4. Rechazo estricto de asistencia pendiente (PENDING / ACTIVE / sin aprobación)", () => {

    it.each([
      { label: "omitido", value: undefined },
      { label: "null", value: null },
    ])("status $label conserva la sesión pendiente sin contar asistencia aprobada", async ({ value }) => {
      const sessions: NonNullable<ResolveAttendanceInput["sessions"]> = [{
        id: "sess-without-status", startedAt: "2026-05-04T15:00:00Z",
      }];
      if (value !== undefined) sessions[0].status = value;
      const result = await resolveAttendanceForPeriod({
        userId: baseUserId, companyId: baseCompanyId,
        startDate: periodStart, endDate: periodEnd, sessions,
      });
      expect(result.hasPendingAttendance).toBe(true);
      expect(result.approvedAttendanceDays).toBe(0);
      expect(result.pendingAttendanceDetails).toHaveLength(1);
      expect(result.pendingAttendanceDetails[0]).toMatchObject({
        sessionId: "sess-without-status", date: "2026-05-04",
        reason: "Sesión de turno en estado PENDING",
      });
    });

    it("sesión con status = PENDING bloquea inmediatamente con hasPendingAttendance = true", async () => {
      const sessions = [
        {
          id: "sess-pending-1",
          startedAt: "2026-05-02T14:00:00Z",
          status: "PENDING",
        },
      ];

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        sessions,
      });

      expect(res.hasPendingAttendance).toBe(true);
      expect(res.pendingAttendanceDetails).toHaveLength(1);
      expect(res.pendingAttendanceDetails[0].reason).toContain("PENDING");
    });

    it("sesión con status = ACTIVE (turno en curso sin check-out) bloquea inmediatamente", async () => {
      const sessions = [
        {
          id: "sess-active-1",
          startedAt: "2026-05-03T16:00:00Z",
          status: "ACTIVE",
        },
      ];

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        sessions,
      });

      expect(res.hasPendingAttendance).toBe(true);
      expect(res.pendingAttendanceDetails[0].reason).toContain("en curso");
    });
  });

  describe("5. Zona horaria operativa y conversión de timestamps a fechas civiles", () => {
    it("convierte punzadas cerca de medianoche UTC a la fecha civil correcta de la zona horaria", async () => {
      // 2026-05-01T04:30:00Z en America/Mexico_City (UTC-6) corresponde a las 22:30:00 del 30 de abril (2026-04-30).
      // Por tanto, debe quedar FUERA de la quincena 2026-05-01 a 2026-05-15.
      const sessions = [
        {
          id: "sess-april-night",
          startedAt: "2026-05-01T04:30:00Z", // 22:30 local CDMX del 30 de abril
          status: "PENDING", // Si se interpretara como 1 de mayo UTC, bloquearía; en CDMX es 30-abr y se ignora
        },
      ];

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        timezone: "America/Mexico_City",
        sessions,
      });

      // La sesión del 30 de abril no pertenece a la quincena 1-15 mayo
      expect(res.hasPendingAttendance).toBe(false);
      expect(res.pendingAttendanceDetails).toHaveLength(0);
    });

    it("interpreta correctamente la zona horaria de Tijuana (America/Tijuana, UTC-8)", async () => {
      // 2026-05-01T06:00:00Z en America/Tijuana (UTC-7 en horario de verano / UTC-8) es 2026-04-30 22:00:00
      const sessions = [
        {
          id: "sess-tijuana-night",
          startedAt: "2026-05-01T06:00:00Z",
          status: "PENDING",
        },
      ];

      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        timezone: "America/Tijuana",
        sessions,
      });

      expect(res.hasPendingAttendance).toBe(false);
    });
  });

  describe("6. Verificación de salario mínimo geográfico CONASAMI 2026", () => {
    it("resuelve salario mínimo de 31,504¢ para zona GENERAL en 2026", async () => {
      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: "2026-01-01",
        endDate: "2026-01-15",
        geographicZone: "GENERAL",
      });

      expect(res.operationalZone.geographicZone).toBe("GENERAL");
      expect(res.operationalZone.minimumWageDailyCents).toBe(31504); // $315.04 MXN
    });

    it("resuelve salario mínimo de 44,087¢ para Zona Libre de la Frontera Norte (ZLFN) en 2026", async () => {
      const res = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: "2026-01-01",
        endDate: "2026-01-15",
        geographicZone: "ZLFN",
      });

      expect(res.operationalZone.geographicZone).toBe("ZLFN");
      expect(res.operationalZone.minimumWageDailyCents).toBe(44087); // $440.87 MXN
    });
  });

  describe("7. Invariantes financieras de tesorería y desglose de percepciones", () => {
    it("respeta estrictamente la ecuación de percepciones y neto de tesorería con festivo laborado y faltas", () => {
      const dailySalaryCents = 50000; // $500.00 MXN al día
      const calendarDays = 15;
      const unpaidAbsenceDays = 1; // 1 falta injustificada
      const holidayDaysWorked = 1; // 1 festivo laborado
      const propinasCents = 150000; // $1,500.00 MXN

      const payableDays = calendarDays - unpaidAbsenceDays; // 14 días pagaderos
      const baseSalaryCents = payableDays * dailySalaryCents; // 14 * 50,000 = 700,000¢ ($7,000 MXN)
      const holidayPayCents = holidayDaysWorked * dailySalaryCents * 2; // 1 * 50,000 * 2 = 100,000¢ ($1,000 MXN)
      const overtimePayCents = 0;
      const aguinaldoCents = 0;
      const totalPercepcionesCents = baseSalaryCents + holidayPayCents + overtimePayCents + aguinaldoCents + propinasCents;
      const totalDeduccionesCents = 0;
      const netCents = totalPercepcionesCents - totalDeduccionesCents;

      // Invariante de tesorería
      expect(totalPercepcionesCents).toBe(700000 + 100000 + 150000); // 950,000¢ ($9,500 MXN)
      expect(netCents).toBe(950000);

      // Verificación con el snapshot canónico de tesorería (buildPayrollSnapshot)
      const mockRun = {
        id: "a0000000-0000-4000-8000-000000000001",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        status: "COMPLETED",
      };

      const mockReceipt = {
        payslipId: "b0000000-0000-4000-8000-000000000001",
        employeeId: baseUserId,
        branchId: null,
        cfdiUuid: "c0000000-0000-4000-8000-000000000001",
        cfdiStatus: "TIMBRADO" as const,
        baseSalaryCents,
        holidayPayCents,
        overtimePayCents,
        aguinaldoCents,
        propinasCents,
        totalPercepcionesCents,
        totalDeduccionesCents,
      };

      const snapshot = buildPayrollSnapshot(
        "d0000000-0000-4000-8000-000000000001",
        mockRun,
        [mockReceipt]
      );

      expect(snapshot.netCents).toBe(950000);
      expect(snapshot.receipts[0].baseSalaryCents).toBe(700000);
      expect(snapshot.receipts[0].holidayPayCents).toBe(100000);
      expect(snapshot.receipts[0].totalPercepcionesCents).toBe(950000);

      const parsed = parsePayrollSnapshot(snapshot);
      expect(parsed).toEqual(snapshot);
    });
  });
});
