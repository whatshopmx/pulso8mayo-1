import { describe, it, expect } from "vitest";
import {
  resolveOvertimeForPeriod,
  resolveAttendanceForPeriod,
  construirDesgloseNomina,
  type OvertimeBreakdown,
} from "../payroll-service";
import { buildPayrollSnapshot, parsePayrollSnapshot } from "@/lib/treasury/payroll-snapshot";
import { payrollPlan } from "@/lib/services/accounting/payroll-contract";

describe("NOM-02.b: Incorporar Horas Extra Aprobadas en Nómina (LFT Arts. 61, 66, 67, 68)", () => {
  const baseUserId = "usr-worker-nom02b";
  const baseCompanyId = "cmp-horeca-nom02b";
  const periodStart = "2026-05-01";
  const periodEnd = "2026-05-15"; // Quincena de 15 días (Mayo 2026)

  describe("1. Horas extra <= 9 horas en una semana calendario única (todas al 200% dobles)", () => {
    it("Case 1: calcula 6 horas extra aprobadas con cuota salario / 8 y recargo 200% (doble)", () => {
      // Salario diario: $480.00 MXN = 48,000 centavos
      // Cuota horaria (Art. 61 LFT): 48,000 / 8 = 6,000 centavos/hora
      // Tarifa doble (Art. 67 LFT): 6,000 * 2 = 12,000 centavos/hora
      // 6 horas extra (360 minutos): 6 * 12,000 = 72,000 centavos ($720.00 MXN)
      const dailySalaryCents = 48000;
      const sessions = [
        {
          id: "sess-w1-1",
          startedAt: "2026-05-04T15:00:00Z", // Lunes de semana W19
          status: "COMPLETED",
          requiresApproval: false,
          approvedAt: new Date("2026-05-04T23:00:00Z"),
          overtimeMinutes: 180, // 3 horas
        },
        {
          id: "sess-w1-2",
          startedAt: "2026-05-06T15:00:00Z", // Miércoles de semana W19
          status: "COMPLETED",
          requiresApproval: false,
          approvedAt: new Date("2026-05-06T23:00:00Z"),
          overtimeMinutes: 180, // 3 horas
        },
      ];

      const res = resolveOvertimeForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        timezone: "America/Mexico_City",
        sessions,
      });

      expect(res.hasOvertime).toBe(true);
      expect(res.totalMinutes).toBe(360);
      expect(res.doubleMinutes).toBe(360);
      expect(res.tripleMinutes).toBe(0);
      expect(res.doublePayCents).toBe(72000);
      expect(res.triplePayCents).toBe(0);
      expect(res.totalPayCents).toBe(72000);
      expect(res.justification).toBe("LFT_ARTS_66_67_68");
      expect(res.approvedSessionsCount).toBe(2);
      expect(res.rejectedCount).toBe(0);
      expect(res.weeklyBreakdown).toHaveLength(1);
      expect(res.weeklyBreakdown[0].doubleMinutes).toBe(360);
      expect(res.weeklyBreakdown[0].tripleMinutes).toBe(0);
      expect(res.weeklyBreakdown[0].doublePayCents).toBe(72000);
    });

    it("Case 1.B: evalúa exactamente el límite frontera de 9.0 horas (540 min) al 200%", () => {
      const dailySalaryCents = 40000; // $400.00 MXN diario (5,000¢/h base, 10,000¢/h doble)
      const sessions = [
        {
          id: "sess-boundary-1",
          startedAt: "2026-05-05T14:00:00Z",
          status: "COMPLETED",
          requiresApproval: false,
          overtimeMinutes: 540, // Exactamente 9 horas
        },
      ];

      const res = resolveOvertimeForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        sessions,
      });

      expect(res.totalMinutes).toBe(540);
      expect(res.doubleMinutes).toBe(540);
      expect(res.tripleMinutes).toBe(0);
      expect(res.doublePayCents).toBe(90000); // 9h * 10,000¢ = 90,000¢
      expect(res.triplePayCents).toBe(0);
      expect(res.totalPayCents).toBe(90000);
    });
  });

  describe("2. Horas extra > 9 horas en una semana calendario única (primeras 9h al 200%, excedente al 300%)", () => {
    it("Case 2: segrega 12 horas extra semanales en 9 horas dobles y 3 horas triples (Art. 68 LFT)", () => {
      // Salario diario: $480.00 MXN = 48,000 centavos
      // Cuota horaria ordinaria: 6,000 centavos
      // Primeras 9 horas dobles (540 min) @ 12,000¢/h = 108,000 centavos
      // Excedente de 3 horas triples (180 min) @ 18,000¢/h = 54,000 centavos
      // Total horas extra = 108,000 + 54,000 = 162,000 centavos ($1,620.00 MXN)
      const dailySalaryCents = 48000;
      const sessions = [
        {
          id: "sess-over-1",
          startedAt: "2026-05-04T15:00:00Z",
          status: "COMPLETED",
          requiresApproval: false,
          overtimeMinutes: 360, // 6 horas
        },
        {
          id: "sess-over-2",
          startedAt: "2026-05-06T15:00:00Z",
          status: "COMPLETED",
          requiresApproval: false,
          overtimeMinutes: 360, // 6 horas (total 12 horas en la misma semana)
        },
      ];

      const res = resolveOvertimeForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        sessions,
      });

      expect(res.totalMinutes).toBe(720);
      expect(res.doubleMinutes).toBe(540);
      expect(res.tripleMinutes).toBe(180);
      expect(res.doublePayCents).toBe(108000);
      expect(res.triplePayCents).toBe(54000);
      expect(res.totalPayCents).toBe(162000);
      expect(res.justification).toBe("LFT_ARTS_66_67_68");
      expect(res.weeklyBreakdown).toHaveLength(1);
      expect(res.weeklyBreakdown[0].doubleMinutes).toBe(540);
      expect(res.weeklyBreakdown[0].tripleMinutes).toBe(180);
      expect(res.weeklyBreakdown[0].doublePayCents).toBe(108000);
      expect(res.weeklyBreakdown[0].triplePayCents).toBe(54000);
    });
  });

  describe("3. Período quincenal con múltiples semanas calendario (topes de 9h independientes por semana)", () => {
    it("Case 3: no fusiona semanas; reinicia el tope de 9h dobles en cada semana calendario", () => {
      // Salario diario: $500.00 MXN = 50,000 centavos
      // Cuota horaria base: 6,250¢ | Doble: 12,500¢ | Triple: 18,750¢
      //
      // Semana W19 (Lunes 4 a Domingo 10 de Mayo):
      // - 8 horas (480 min) extra -> todas dobles = 8 * 12,500 = 100,000 centavos
      //
      // Semana W20 (Lunes 11 a Viernes 15 de Mayo):
      // - 12 horas (720 min) extra:
      //   - Primeras 9h dobles (540 min) = 9 * 12,500 = 112,500 centavos
      //   - Restantes 3h triples (180 min) = 3 * 18,750 = 56,250 centavos
      //   - Total semana 2 = 168,750 centavos
      //
      // Totales del período quincenal:
      // - Dobles: 8h + 9h = 17 horas (1,020 min) -> 212,500 centavos
      // - Triples: 3 horas (180 min) -> 56,250 centavos
      // - Total horas extra = 268,750 centavos ($2,687.50 MXN)
      const dailySalaryCents = 50000;
      const sessions = [
        // Semana W19
        { id: "s-w1-1", startedAt: "2026-05-04T14:00:00Z", status: "COMPLETED", requiresApproval: false, overtimeMinutes: 240 },
        { id: "s-w1-2", startedAt: "2026-05-06T14:00:00Z", status: "COMPLETED", requiresApproval: false, overtimeMinutes: 240 },
        // Semana W20
        { id: "s-w2-1", startedAt: "2026-05-11T14:00:00Z", status: "COMPLETED", requiresApproval: false, overtimeMinutes: 360 },
        { id: "s-w2-2", startedAt: "2026-05-13T14:00:00Z", status: "COMPLETED", requiresApproval: false, overtimeMinutes: 360 },
      ];

      const res = resolveOvertimeForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        timezone: "America/Mexico_City",
        sessions,
      });

      expect(res.totalMinutes).toBe(1200); // 20 horas en total
      expect(res.doubleMinutes).toBe(1020); // 17 horas dobles (8 de W19 + 9 de W20)
      expect(res.tripleMinutes).toBe(180); // 3 horas triples (excedente de W20)
      expect(res.doublePayCents).toBe(212500);
      expect(res.triplePayCents).toBe(56250);
      expect(res.totalPayCents).toBe(268750);
      expect(res.weeklyBreakdown).toHaveLength(2);

      // Verificación de que un agrupamiento plano de 15 días (ilegal) habría dado resultado distinto
      // En agrupamiento plano: 20h totales darían 9h dobles (112,500) + 11h triples (206,250) = 318,750¢
      expect(res.totalPayCents).not.toBe(318750);
    });
  });

  describe("4. Período sin horas extra (Cero Justificado)", () => {
    it("Case 4: produce explícitamente overtimePayCents: 0 y justificación 'SIN_HORAS_EXTRA' sin concepto SAT 019 vacío", () => {
      const dailySalaryCents = 50000;
      const sessions = [
        {
          id: "sess-regular-1",
          startedAt: "2026-05-02T14:00:00Z",
          status: "COMPLETED",
          requiresApproval: false,
          overtimeMinutes: 0,
        },
        {
          id: "sess-regular-2",
          startedAt: "2026-05-03T14:00:00Z",
          status: "COMPLETED",
          requiresApproval: false,
          overtimeMinutes: 0,
        },
      ];

      const res = resolveOvertimeForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        sessions,
      });

      expect(res.hasOvertime).toBe(false);
      expect(res.totalMinutes).toBe(0);
      expect(res.doubleMinutes).toBe(0);
      expect(res.tripleMinutes).toBe(0);
      expect(res.doublePayCents).toBe(0);
      expect(res.triplePayCents).toBe(0);
      expect(res.totalPayCents).toBe(0);
      expect(res.justification).toBe("SIN_HORAS_EXTRA");
      expect(res.weeklyBreakdown).toEqual([]);
      expect(res.approvedSessionsCount).toBe(2);
      expect(res.rejectedCount).toBe(0);

      // Desglose fiscal CFDI: no debe incluir concepto 019 vacío
      const fiscal = construirDesgloseNomina({
        baseSalaryCents: 750000,
        propinasCents: 0,
        holidayPayCents: 0,
        overtimePayCents: res.totalPayCents,
        overtimeBreakdown: res,
      });

      const sat019 = fiscal.desglosePercepciones.find((p) => p.earningTypeCode === "019");
      expect(sat019).toBeUndefined();
    });
  });

  describe("5. Horas extra pendientes de aprobación (bloqueo / pago 0)", () => {
    it("Case 5: sesión con horas extra que requiere aprobación pero no tiene approvedAt bloquea en asistencia", async () => {
      const sessions = [
        {
          id: "sess-unapproved-extra",
          startedAt: "2026-05-04T15:00:00Z",
          status: "COMPLETED",
          requiresApproval: true,
          approvedAt: null,
          overtimeMinutes: 180,
        },
      ];

      const attendance = await resolveAttendanceForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        sessions,
      });

      expect(attendance.hasPendingAttendance).toBe(true);
      expect(attendance.pendingAttendanceDetails).toHaveLength(1);
      expect(attendance.pendingAttendanceDetails[0].sessionId).toBe("sess-unapproved-extra");
      expect(attendance.pendingAttendanceDetails[0].reason).toContain("aprobación");
    });

    it("Case 5.B: horas extra en estado PENDING no computan como aprobadas en el cálculo puro", () => {
      const dailySalaryCents = 50000;
      const sessions = [
        {
          id: "sess-pending-extra",
          startedAt: "2026-05-04T15:00:00Z",
          status: "PENDING",
          requiresApproval: true,
          approvedAt: null,
          overtimeMinutes: 180,
        },
      ];

      const res = resolveOvertimeForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        sessions,
      });

      expect(res.totalMinutes).toBe(0);
      expect(res.totalPayCents).toBe(0);
      expect(res.approvedSessionsCount).toBe(0);
    });
  });

  describe("6. Horas extra rechazadas o canceladas (pago 0 y conteo de rechazo)", () => {
    it("Case 6: turno con horas extra rechazadas produce 0 pago e incrementa rejectedCount", () => {
      const dailySalaryCents = 48000;
      const sessions = [
        {
          id: "sess-rejected-1",
          startedAt: "2026-05-04T15:00:00Z",
          status: "REJECTED",
          overtimeMinutes: 240,
          rejectionReason: "Horas extra no autorizadas por la gerencia",
        },
      ];

      const res = resolveOvertimeForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        sessions,
      });

      expect(res.totalMinutes).toBe(0);
      expect(res.totalPayCents).toBe(0);
      expect(res.approvedSessionsCount).toBe(0);
      expect(res.rejectedCount).toBe(1);
    });

    it("Case 6.B: turno cancelado o con solicitud vinculada en estado CANCELLED produce 0 pago", () => {
      const dailySalaryCents = 48000;
      const sessions = [
        {
          id: "sess-cancelled-1",
          startedAt: "2026-05-04T15:00:00Z",
          status: "CANCELLED",
          overtimeMinutes: 180,
          rejectionReason: "Turno cancelado por falta de insumos",
        },
      ];

      const res = resolveOvertimeForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        sessions,
      });

      expect(res.totalMinutes).toBe(0);
      expect(res.totalPayCents).toBe(0);
      expect(res.rejectedCount).toBe(1);
    });
  });

  describe("7. Deduplicación e Idempotencia (prevención estricta de conteo doble)", () => {
    it("Case 7: registros duplicados de la misma sesión o sesión con aprobación vinculada se cuentan una sola vez", () => {
      const dailySalaryCents = 48000;
      // Simula el escenario donde una consulta une shift_sessions y shift_approvals
      // produciendo registros duplicados para el mismo sessionId
      const sessions = [
        {
          id: "sess-dup-1",
          startedAt: "2026-05-04T15:00:00Z",
          status: "COMPLETED",
          requiresApproval: false,
          overtimeMinutes: 120, // 2 horas = 24,000¢
        },
        {
          id: "sess-dup-1", // Mismo sessionId duplicado
          startedAt: "2026-05-04T15:00:00Z",
          status: "COMPLETED",
          requiresApproval: false,
          overtimeMinutes: 120,
        },
      ];

      const res = resolveOvertimeForPeriod({
        userId: baseUserId,
        companyId: baseCompanyId,
        startDate: periodStart,
        endDate: periodEnd,
        dailySalaryCents,
        sessions,
      });

      // Debe tomar exactamente 120 minutos (1 sesión), NO 240 minutos
      expect(res.totalMinutes).toBe(120);
      expect(res.doubleMinutes).toBe(120);
      expect(res.doublePayCents).toBe(24000);
      expect(res.totalPayCents).toBe(24000);
      expect(res.approvedSessionsCount).toBe(1);
    });
  });

  describe("8. Integración contable con totalPercepcionesCents y snapshot de tesorería", () => {
    it("Case 8: totalPercepcionesCents integra exactamente el overtimePayCents y valida payrollPlan y buildPayrollSnapshot", () => {
      const baseSalaryCents = 700000; // $7,000 MXN
      const propinasCents = 50000; // $500 MXN
      const holidayPayCents = 100000; // $1,000 MXN
      const overtimePayCents = 72000; // $720 MXN (6h dobles de Case 1)
      const aguinaldoCents = 0;
      const totalPercepcionesCents = baseSalaryCents + propinasCents + holidayPayCents + overtimePayCents;
      const totalDeduccionesCents = 0;

      expect(totalPercepcionesCents).toBe(922000);

      // Verificación de reconocimiento contable (payrollPlan)
      const receipt = {
        payslipId: "aaaaaaaa-1111-4111-8111-111111111111",
        employeeId: baseUserId,
        branchId: null,
        cfdiUuid: "bbbbbbbb-2222-4222-8222-222222222222",
        cfdiStatus: "TIMBRADO" as const,
        baseSalaryCents,
        holidayPayCents,
        overtimePayCents,
        aguinaldoCents,
        propinasCents,
        totalPercepcionesCents,
        totalDeduccionesCents,
      };

      const journal = payrollPlan({ kind: "RECOGNITION", ...receipt });
      expect(journal).toHaveLength(3); // PAYROLL_EXPENSE, TIPS_PAYABLE, PAYROLL_PAYABLE
      const expenseLine = journal.find((j) => j.role === "PAYROLL_EXPENSE");
      expect(expenseLine?.debitCents).toBe(baseSalaryCents + holidayPayCents + overtimePayCents);

      // Verificación de snapshot inmutable de tesorería
      const run = {
        id: "cccccccc-3333-4333-8333-333333333333",
        periodStart,
        periodEnd,
        status: "COMPLETED",
      };

      const snapshot = buildPayrollSnapshot("dddddddd-4444-4444-8444-444444444444", run, [receipt]);
      expect(snapshot.netCents).toBe(922000);
      expect(snapshot.receipts[0].overtimePayCents).toBe(72000);
      expect(parsePayrollSnapshot(snapshot)).toBeDefined();

      // Contra-prueba: si overtimePayCents > 0 pero no se suma a totalPercepcionesCents, debe fallar
      const brokenReceipt = {
        ...receipt,
        totalPercepcionesCents: baseSalaryCents + propinasCents + holidayPayCents, // Omite overtimePayCents
      };
      expect(() => payrollPlan({ kind: "RECOGNITION", ...brokenReceipt })).toThrow(
        /Las percepciones documentadas no coinciden con sus componentes/i
      );
    });
  });

  describe("9. Desglose fiscal CFDI concepto 019 y exención LISR Art. 93 Frac. I", () => {
    const UMA_DIARIA_CENTS_2026 = 11314; // $113.14 MXN
    const LIMITE_5_UMA_SEMANAL = 5 * UMA_DIARIA_CENTS_2026; // 56,570 centavos ($565.70 MXN)

    it("Case 9.A: horas dobles por debajo del tope de 5 UMA: 50% exento y 50% gravado", () => {
      // 40,000 centavos de horas dobles en 1 semana
      // 50% = 20,000 centavos <= 56,570 centavos
      // Exento = 20,000 centavos | Gravado = 20,000 centavos
      const breakdown: OvertimeBreakdown = {
        totalMinutes: 240,
        doubleMinutes: 240,
        tripleMinutes: 0,
        doublePayCents: 40000,
        triplePayCents: 0,
        totalPayCents: 40000,
        hasOvertime: true,
        justification: "LFT_ARTS_66_67_68",
        approvedSessionsCount: 1,
        rejectedCount: 0,
        weeklyBreakdown: [
          {
            calendarWeek: "2026-W19",
            doubleMinutes: 240,
            tripleMinutes: 0,
            doublePayCents: 40000,
            triplePayCents: 0,
          },
        ],
      };

      const fiscal = construirDesgloseNomina({
        baseSalaryCents: 600000,
        propinasCents: 0,
        overtimePayCents: 40000,
        overtimeBreakdown: breakdown,
      });

      const sat019 = fiscal.desglosePercepciones.find((p) => p.earningTypeCode === "019");
      expect(sat019).toBeDefined();
      expect(sat019?.concept).toContain("Horas extra");
      expect(sat019?.exemptAmount).toBe(20000);
      expect(sat019?.taxedAmount).toBe(20000);
      expect((sat019?.exemptAmount ?? 0) + (sat019?.taxedAmount ?? 0)).toBe(40000);
    });

    it("Case 9.B: horas dobles que exceden el tope de 5 UMA: exención topada a 56,570¢", () => {
      // 160,000 centavos de horas dobles en 1 semana
      // 50% = 80,000 centavos > 56,570 centavos (tope 5 UMA)
      // Exento = 56,570 centavos | Gravado = 160,000 - 56,570 = 103,430 centavos
      const breakdown: OvertimeBreakdown = {
        totalMinutes: 540,
        doubleMinutes: 540,
        tripleMinutes: 0,
        doublePayCents: 160000,
        triplePayCents: 0,
        totalPayCents: 160000,
        hasOvertime: true,
        justification: "LFT_ARTS_66_67_68",
        approvedSessionsCount: 2,
        rejectedCount: 0,
        weeklyBreakdown: [
          {
            calendarWeek: "2026-W19",
            doubleMinutes: 540,
            tripleMinutes: 0,
            doublePayCents: 160000,
            triplePayCents: 0,
          },
        ],
      };

      const fiscal = construirDesgloseNomina({
        baseSalaryCents: 600000,
        propinasCents: 0,
        overtimePayCents: 160000,
        overtimeBreakdown: breakdown,
      });

      const sat019 = fiscal.desglosePercepciones.find((p) => p.earningTypeCode === "019");
      expect(sat019).toBeDefined();
      expect(sat019?.exemptAmount).toBe(LIMITE_5_UMA_SEMANAL);
      expect(sat019?.taxedAmount).toBe(160000 - LIMITE_5_UMA_SEMANAL);
    });

    it("Case 9.C: horas triples son 100% gravadas (sin exención) combinadas con horas dobles", () => {
      // 9h dobles (90,000¢) + 3h triples (45,000¢) = 135,000 centavos
      // Dobles: 50% de 90,000 = 45,000¢ <= 56,570¢ -> Exento = 45,000¢, Gravado = 45,000¢
      // Triples: 100% gravadas -> Gravado = 45,000¢, Exento = 0¢
      // Total Concepto 019: Exento = 45,000¢ | Gravado = 90,000¢ | Suma = 135,000¢
      const breakdown: OvertimeBreakdown = {
        totalMinutes: 720,
        doubleMinutes: 540,
        tripleMinutes: 180,
        doublePayCents: 90000,
        triplePayCents: 45000,
        totalPayCents: 135000,
        hasOvertime: true,
        justification: "LFT_ARTS_66_67_68",
        approvedSessionsCount: 2,
        rejectedCount: 0,
        weeklyBreakdown: [
          {
            calendarWeek: "2026-W19",
            doubleMinutes: 540,
            tripleMinutes: 180,
            doublePayCents: 90000,
            triplePayCents: 45000,
          },
        ],
      };

      const fiscal = construirDesgloseNomina({
        baseSalaryCents: 600000,
        propinasCents: 0,
        overtimePayCents: 135000,
        overtimeBreakdown: breakdown,
      });

      const sat019 = fiscal.desglosePercepciones.find((p) => p.earningTypeCode === "019");
      expect(sat019).toBeDefined();
      expect(sat019?.exemptAmount).toBe(45000);
      expect(sat019?.taxedAmount).toBe(90000);
      expect((sat019?.exemptAmount ?? 0) + (sat019?.taxedAmount ?? 0)).toBe(135000);
    });

    it("Case 9.D: acumulación de exención en 2 semanas calendario independientes", () => {
      // Semana W19: 100,000¢ dobles -> 50% = 50,000¢ <= 56,570¢ -> Exento W19 = 50,000¢
      // Semana W20: 140,000¢ dobles -> 50% = 70,000¢ > 56,570¢ -> Exento W20 = 56,570¢
      // Total exento = 50,000 + 56,570 = 106,570 centavos
      // Total percepciones extra = 240,000 centavos
      // Total gravado = 240,000 - 106,570 = 133,430 centavos
      const breakdown: OvertimeBreakdown = {
        totalMinutes: 1080,
        doubleMinutes: 1080,
        tripleMinutes: 0,
        doublePayCents: 240000,
        triplePayCents: 0,
        totalPayCents: 240000,
        hasOvertime: true,
        justification: "LFT_ARTS_66_67_68",
        approvedSessionsCount: 4,
        rejectedCount: 0,
        weeklyBreakdown: [
          { calendarWeek: "2026-W19", doubleMinutes: 480, tripleMinutes: 0, doublePayCents: 100000, triplePayCents: 0 },
          { calendarWeek: "2026-W20", doubleMinutes: 600, tripleMinutes: 0, doublePayCents: 140000, triplePayCents: 0 },
        ],
      };

      const fiscal = construirDesgloseNomina({
        baseSalaryCents: 600000,
        propinasCents: 0,
        overtimePayCents: 240000,
        overtimeBreakdown: breakdown,
      });

      const sat019 = fiscal.desglosePercepciones.find((p) => p.earningTypeCode === "019");
      expect(sat019).toBeDefined();
      expect(sat019?.exemptAmount).toBe(106570);
      expect(sat019?.taxedAmount).toBe(133430);
    });
  });
});
