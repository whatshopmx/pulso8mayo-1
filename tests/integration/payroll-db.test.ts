import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  companies,
  branches,
  users,
  employeeProfiles,
  employeeContracts,
  salaryHistory,
  shiftSessions,
  shiftApprovals,
  holidays,
  vacationRequests,
  vacationAccruals,
  leaveRequests,
  leaveTypes,
  payrollRuns,
  payrollPayslips,
} from "@/lib/db/schema";
import {
  isPayrollPeriodFrozen,
  executePayrollRun,
  validatePayrollPreStamping,
  calculateEmployeePayroll,
} from "@/lib/services/payroll-service";
import { provisionRuntimeRole } from "./helpers/runtime-role";

describe("NOM-01 V2 + NOM-02.a V2: Base salarial, congelamiento e inmutabilidad en Postgres aislado", () => {
  beforeAll(async () => {
    await provisionRuntimeRole([
      "companies",
      "branches",
      "users",
      "employee_profiles",
      "employee_contracts",
      "salary_history",
      "shift_sessions",
      "shift_approvals",
      "holidays",
      "leave_types",
      "leave_requests",
      "vacation_requests",
      "vacation_accruals",
      "leave_balances",
      "payroll_runs",
      "payroll_payslips",
      "propinas",
      "propina_asignaciones",
    ]);
    await db.execute(sql`DO $$ BEGIN EXECUTE format('GRANT pulso_app TO %I', current_user); END $$`);
  });

  interface TestContext {
    companyIdA: string;
    companyIdB: string;
    branchIdA: string;
    branchIdB: string;
    userIdA: string;
    userIdB: string;
    contractIdA: string;
  }

  async function runWithIsolation(
    testFn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ctx: TestContext) => Promise<void>
  ) {
    const companyIdA = randomUUID();
    const companyIdB = randomUUID();
    const branchIdA = randomUUID();
    const branchIdB = randomUUID();
    const userIdA = `usr-${randomUUID()}`;
    const userIdB = `usr-${randomUUID()}`;
    const contractIdA = randomUUID();

    const ctx: TestContext = {
      companyIdA,
      companyIdB,
      branchIdA,
      branchIdB,
      userIdA,
      userIdB,
      contractIdA,
    };

    await expect(
      db.transaction(async (tx) => {
        // 1. Fixtures base
        await tx.insert(companies).values([
          { id: companyIdA, name: "Empresa Nómina A" },
          { id: companyIdB, name: "Empresa Nómina B" },
        ]);

        await tx.insert(branches).values([
          { id: branchIdA, companyId: companyIdA, name: "Sucursal A CDMX", timezone: "America/Mexico_City" },
          { id: branchIdB, companyId: companyIdB, name: "Sucursal B Tijuana", timezone: "America/Tijuana" },
        ]);

        await tx.insert(users).values([
          { id: userIdA, companyId: companyIdA, branchId: branchIdA, name: "Empleado A", email: `emp-a-${randomUUID()}@horeca.mx`, createdAt: new Date(), updatedAt: new Date() },
          { id: userIdB, companyId: companyIdB, branchId: branchIdB, name: "Empleado B", email: `emp-b-${randomUUID()}@horeca.mx`, createdAt: new Date(), updatedAt: new Date() },
        ]);

        await tx.insert(employeeProfiles).values([
          {
            id: randomUUID(),
            userId: userIdA,
            rfc: "EMPA900101XYZ",
            curp: "EMPA900101HDFXXX01",
            employeeNumber: "EMP-001",
            isActive: true,
            createdBy: userIdA,
          },
          {
            id: randomUUID(),
            userId: userIdB,
            rfc: "EMPB900202XYZ",
            curp: "EMPB900202HDFXXX02",
            employeeNumber: "EMP-002",
            isActive: true,
            createdBy: userIdB,
          },
        ]);

        await tx.insert(employeeContracts).values([
          {
            id: contractIdA,
            companyId: companyIdA,
            userId: userIdA,
            contractNumber: "CTR-A-001",
            baseSalary: 50000, // $500.00 MXN diario en centavos
            currency: "MXN",
            startDate: new Date("2026-01-01T00:00:00Z"),
            status: "ACTIVE",
            createdBy: userIdA,
          },
        ]);

        // Asumir rol limitado pulso_app (NOBYPASSRLS)
        await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
        await tx.execute(sql`SELECT set_config('app.current_company_id', ${companyIdA}, true)`);

        await testFn(tx, ctx);

        throw new Error("ROLLBACK_EXPECTED_PAYROLL_DB");
      })
    ).rejects.toThrow("ROLLBACK_EXPECTED_PAYROLL_DB");

    // Verificar limpieza total de datos sintéticos
    const remainingCompanies = await db.select().from(companies).where(inArray(companies.id, [companyIdA, companyIdB]));
    expect(remainingCompanies).toHaveLength(0);
    const remainingRuns = await db.select().from(payrollRuns).where(inArray(payrollRuns.companyId, [companyIdA, companyIdB]));
    expect(remainingRuns).toHaveLength(0);
  }

  it("verifica runtime pulso_app con rolsuper: false y rolbypassrls: false en Postgres aislado", async () => {
    await runWithIsolation(async (tx) => {
      const result = await tx.execute(sql`
        SELECT current_user AS role, r.rolbypassrls, r.rolsuper
        FROM pg_roles r
        WHERE r.rolname = current_user
      `);
      expect(result.rows).toEqual([
        expect.objectContaining({ role: "pulso_app", rolbypassrls: false, rolsuper: false }),
      ]);
    });
  });

  it("NOM-01 V2: isPayrollPeriodFrozen y bloqueo de executePayrollRun en período completado", async () => {
    await runWithIsolation(async (tx, ctx) => {
      const periodStart = "2026-05-01";
      const periodEnd = "2026-05-15";

      // Período aún no corrido
      const initialFrozen = await isPayrollPeriodFrozen(ctx.companyIdA, periodStart, periodEnd, tx);
      expect(initialFrozen).toBe(false);

      // Insertar corrida completada
      const [completedRun] = await tx
        .insert(payrollRuns)
        .values({
          companyId: ctx.companyIdA,
          periodStart,
          periodEnd,
          status: "COMPLETED",
        })
        .returning();

      expect(completedRun.id).toBeDefined();

      // Verificar congelamiento en empresa A
      const isFrozenA = await isPayrollPeriodFrozen(ctx.companyIdA, periodStart, periodEnd, tx);
      expect(isFrozenA).toBe(true);

      // Para otro período de empresa A no debe estar congelado
      const isFrozenOther = await isPayrollPeriodFrozen(ctx.companyIdA, "2026-05-16", "2026-05-31", tx);
      expect(isFrozenOther).toBe(false);

      // Para empresa B no debe estar congelado
      const isFrozenB = await isPayrollPeriodFrozen(ctx.companyIdB, periodStart, periodEnd, tx);
      expect(isFrozenB).toBe(false);

      // executePayrollRun debe lanzar error si el período está congelado
      await expect(
        executePayrollRun(ctx.companyIdA, periodStart, periodEnd, "test-actor", { dbInstance: tx })
      ).rejects.toThrow(/ya fue completado y se encuentra congelado/i);
    });
  });

  it("NOM-01 V2: Inmutabilidad de recibos previos frente a incrementos salariales posteriores", async () => {
    await runWithIsolation(async (tx, ctx) => {
      const periodStart = "2026-05-01";
      const periodEnd = "2026-05-15";

      // 1. Insertar corrida completada con su recibo emitido
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          companyId: ctx.companyIdA,
          periodStart,
          periodEnd,
          status: "COMPLETED",
        })
        .returning();

      const [payslip] = await tx
        .insert(payrollPayslips)
        .values({
          runId: run.id,
          userId: ctx.userIdA,
          baseSalaryCents: 750000, // 15 días x $500.00 MXN
          propinasCents: 0,
          holidayPayCents: 0,
          overtimePayCents: 0,
          totalPercepcionesCents: 750000,
          totalDeduccionesCents: 0,
          cfdiStatus: "TIMBRADO",
          cfdiUuid: randomUUID(),
        })
        .returning();

      // 2. Registrar aumento salarial posterior al período (vigencia 1 de junio)
      await tx.insert(salaryHistory).values({
        contractId: ctx.contractIdA,
        userId: ctx.userIdA,
        previousSalary: 50000,
        newSalary: 100000, // Salario duplicado a $1,000.00 MXN
        changeType: "PROMOTION",
        approvedBy: ctx.userIdA,
        effectiveDate: new Date("2026-06-01T00:00:00Z"),
        reason: "Aumento de desempeño",
      });

      // 3. Consultar recibo guardado: debe permanecer estrictamente inmutable
      const [storedPayslip] = await tx
        .select()
        .from(payrollPayslips)
        .where(eq(payrollPayslips.id, payslip.id));

      expect(storedPayslip.baseSalaryCents).toBe(750000);
      expect(storedPayslip.totalPercepcionesCents).toBe(750000);

      // El período sigue congelado
      expect(await isPayrollPeriodFrozen(ctx.companyIdA, periodStart, periodEnd, tx)).toBe(true);
    });
  });

  it("NOM-02.a V2: Rechazo estricto de asistencia pendiente en base de datos real", async () => {
    await runWithIsolation(async (tx, ctx) => {
      const periodStart = "2026-05-01";
      const periodEnd = "2026-05-15";

      // Insertar sesión de asistencia en estado PENDING
      await tx.insert(shiftSessions).values({
        userId: ctx.userIdA,
        branchId: ctx.branchIdA,
        status: "PENDING",
        startedAt: new Date("2026-05-02T15:00:00Z"),
      });

      // validatePayrollPreStamping debe reportar PENDING_ATTENDANCE como BLOCKING
      const validation = await validatePayrollPreStamping(
        ctx.companyIdA,
        periodStart,
        periodEnd,
        ctx.branchIdA,
        { dbInstance: tx }
      );

      expect(validation.canStamp).toBe(false);
      const pendingError = validation.validationErrors.find((e) => e.code === "PENDING_ATTENDANCE");
      expect(pendingError).toBeDefined();
      expect(pendingError?.severity).toBe("BLOCKING");

      // calculateEmployeePayroll debe lanzar RangeError descriptivo
      await expect(
        calculateEmployeePayroll(ctx.userIdA, periodStart, periodEnd, { dbInstance: tx })
      ).rejects.toThrow(/asistencia pendiente en el período/i);
    });
  });

  it("NOM-02.a V2: Cálculo de base salarial desde asistencia aprobada, faltas y festivos en DB real", async () => {
    await runWithIsolation(async (tx, ctx) => {
      const periodStart = "2026-05-01";
      const periodEnd = "2026-05-15";

      // 1. Día festivo obligatorio trabajado (1 de mayo - Día del Trabajo)
      await tx.insert(holidays).values({
        companyId: ctx.companyIdA,
        name: "Día del Trabajo",
        date: "2026-05-01",
        isMandatory: true,
      });

      // Sesión aprobada en festivo (1 de mayo)
      await tx.insert(shiftSessions).values({
        userId: ctx.userIdA,
        branchId: ctx.branchIdA,
        status: "COMPLETED",
        requiresApproval: false,
        startedAt: new Date("2026-05-01T15:00:00Z"),
      });

      // 2. Sesión aprobada ordinaria (2 de mayo)
      await tx.insert(shiftSessions).values({
        userId: ctx.userIdA,
        branchId: ctx.branchIdA,
        status: "COMPLETED",
        requiresApproval: false,
        startedAt: new Date("2026-05-02T15:00:00Z"),
      });

      // 3. Falta injustificada registrada (5 de mayo - NO_SHOW)
      await tx.insert(shiftSessions).values({
        userId: ctx.userIdA,
        branchId: ctx.branchIdA,
        status: "NO_SHOW",
        startedAt: new Date("2026-05-05T15:00:00Z"),
      });

      // Ejecutar cálculo en la base de datos
      const payroll = await calculateEmployeePayroll(ctx.userIdA, periodStart, periodEnd, {
        dbInstance: tx,
      });

      // Verificaciones:
      // - 15 días de período menos 1 falta (NO_SHOW) = 14 días pagaderos
      // - Salario diario: 50,000 centavos ($500.00 MXN)
      // - Base devengada: 14 * 50,000 = 700,000 centavos ($7,000.00 MXN)
      expect(payroll.baseSalaryCents).toBe(700000);
      expect(payroll.holidayDaysWorked).toBe(1);
      // Prima festivo trabajado (Art. 75 LFT): 1 festivo laborado x 50,000 x 2 = 100,000 centavos ($1,000.00 MXN)
      expect(payroll.holidayPayCents).toBe(100000);
      expect(payroll.totalPercepcionesCents).toBe(800000); // 700,000 + 100,000
      expect(payroll.totalDeduccionesCents).toBe(0);

      // Desglose de asistencia
      expect(payroll.attendanceBreakdown).toBeDefined();
      expect(payroll.attendanceBreakdown.calendarDays).toBe(15);
      expect(payroll.attendanceBreakdown.payableDays).toBe(14);
      expect(payroll.attendanceBreakdown.unpaidAbsenceDays).toBe(1);
      expect(payroll.attendanceBreakdown.holidayDaysWorked).toBe(1);
      expect(payroll.attendanceBreakdown.hasPendingAttendance).toBe(false);
      expect(payroll.attendanceBreakdown.operationalZone.timezone).toBe("America/Mexico_City");
      expect(payroll.attendanceBreakdown.operationalZone.geographicZone).toBe("GENERAL");
      expect(payroll.attendanceBreakdown.operationalZone.minimumWageDailyCents).toBe(31504);
    });
  });

  it("aislamiento multi-empresa bajo pulso_app (NOBYPASSRLS)", async () => {
    await runWithIsolation(async (tx, ctx) => {
      // 1. Con contexto de empresa A, intentar insertar corrida para empresa B se rechaza por RLS
      await tx.execute(sql.raw("SAVEPOINT forbidden_payroll_insert"));
      let errorCode: string | undefined;
      try {
        await tx.insert(payrollRuns).values({
          companyId: ctx.companyIdB,
          periodStart: "2026-05-01",
          periodEnd: "2026-05-15",
          status: "COMPLETED",
        });
      } catch (error: unknown) {
        const failure = error as { code?: string; cause?: { code?: string } };
        errorCode = failure.cause?.code || failure.code;
      }
      await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT forbidden_payroll_insert"));
      expect(errorCode).toBe("42501");

      // 2. Insertar corrida bajo contexto legítimo de empresa B
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${ctx.companyIdB}, true)`);
      const [runB] = await tx.insert(payrollRuns).values({
        companyId: ctx.companyIdB,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        status: "COMPLETED",
      }).returning();
      expect(runB.id).toBeDefined();

      // 3. Volver al contexto de empresa A: la corrida de empresa B no es visible bajo pulso_app
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${ctx.companyIdA}, true)`);
      const visibleFromA = await tx
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.companyId, ctx.companyIdB));
      expect(visibleFromA).toHaveLength(0);
    });
  });

  // =========================================================================
  // NOM-02.b V2: Horas Extra en Base de Datos Real bajo pulso_app (NOBYPASSRLS)
  // =========================================================================

  it("NOM-02.b V2: Cálculo de horas extra en base de datos real con sesiones aprobadas y bandas dobles/triples", async () => {
    await runWithIsolation(async (tx, ctx) => {
      const periodStart = "2026-05-01";
      const periodEnd = "2026-05-15";

      // Empleado con contrato activo a $500.00 MXN diario (50,000¢)
      // Cuota horaria base: 6,250¢ | Doble: 12,500¢/h | Triple: 18,750¢/h
      //
      // 1. Sesión 1 (Lunes 4 de mayo, W19): 4 horas extra (240 min)
      await tx.insert(shiftSessions).values({
        userId: ctx.userIdA,
        branchId: ctx.branchIdA,
        status: "COMPLETED",
        requiresApproval: false,
        startedAt: new Date("2026-05-04T14:00:00Z"),
        totalWorkMinutes: 720,
        overtimeMinutes: 240, // 4h extra
      });

      // 2. Sesión 2 (Miércoles 6 de mayo, W19): 7 horas extra (420 min)
      // Total semana W19: 240 + 420 = 660 minutos (11 horas extra)
      // Segregación semanal: 9h dobles (540 min) + 2h triples (120 min)
      // Dobles: 9h * 12,500¢ = 112,500¢
      // Triples: 2h * 18,750¢ = 37,500¢
      // Total extra esperado: 150,000¢ ($1,500.00 MXN)
      await tx.insert(shiftSessions).values({
        userId: ctx.userIdA,
        branchId: ctx.branchIdA,
        status: "COMPLETED",
        requiresApproval: false,
        startedAt: new Date("2026-05-06T14:00:00Z"),
        totalWorkMinutes: 900,
        overtimeMinutes: 420, // 7h extra
      });

      // Ejecutar cálculo en base de datos
      const payroll = await calculateEmployeePayroll(ctx.userIdA, periodStart, periodEnd, {
        dbInstance: tx,
      });

      expect(payroll.overtimePayCents).toBe(150000);
      expect(payroll.overtimeBreakdown).toBeDefined();
      expect(payroll.overtimeBreakdown.totalMinutes).toBe(660);
      expect(payroll.overtimeBreakdown.doubleMinutes).toBe(540);
      expect(payroll.overtimeBreakdown.tripleMinutes).toBe(120);
      expect(payroll.overtimeBreakdown.doublePayCents).toBe(112500);
      expect(payroll.overtimeBreakdown.triplePayCents).toBe(37500);
      expect(payroll.overtimeBreakdown.hasOvertime).toBe(true);
      expect(payroll.overtimeBreakdown.justification).toBe("LFT_ARTS_66_67_68");

      // Invariante de percepciones totales: base devengada + horas extra
      expect(payroll.totalPercepcionesCents).toBe(payroll.baseSalaryCents + 150000);
    });
  });

  it("NOM-02.b V2: Persistencia en payroll_payslips.overtime_pay_cents y protección de período congelado", async () => {
    await runWithIsolation(async (tx, ctx) => {
      const periodStart = "2026-05-01";
      const periodEnd = "2026-05-15";

      // Sesión aprobada con 3 horas extra (180 min dobles)
      // Salario diario 50,000¢ -> 3h dobles = 3 * 12,500 = 37,500¢
      await tx.insert(shiftSessions).values({
        userId: ctx.userIdA,
        branchId: ctx.branchIdA,
        status: "COMPLETED",
        requiresApproval: false,
        startedAt: new Date("2026-05-04T14:00:00Z"),
        overtimeMinutes: 180,
      });

      // Calcular nómina del empleado con horas extra
      const payroll = await calculateEmployeePayroll(ctx.userIdA, periodStart, periodEnd, {
        dbInstance: tx,
      });
      expect(payroll.overtimePayCents).toBe(37500);

      // Insertar corrida completada y recibo persistiendo overtimePayCents
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          companyId: ctx.companyIdA,
          periodStart,
          periodEnd,
          status: "COMPLETED",
        })
        .returning();

      const [storedPayslip] = await tx
        .insert(payrollPayslips)
        .values({
          runId: run.id,
          userId: ctx.userIdA,
          baseSalaryCents: payroll.baseSalaryCents,
          propinasCents: payroll.propinasCents,
          holidayPayCents: payroll.holidayPayCents,
          overtimePayCents: payroll.overtimePayCents,
          totalPercepcionesCents: payroll.totalPercepcionesCents,
          totalDeduccionesCents: payroll.totalDeduccionesCents,
          cfdiStatus: "TIMBRADO",
          cfdiUuid: randomUUID(),
        })
        .returning();

      expect(storedPayslip).toBeDefined();
      expect(storedPayslip.overtimePayCents).toBe(37500);
      expect(storedPayslip.totalPercepcionesCents).toBe(storedPayslip.baseSalaryCents + 37500);

      // Verificar que el período queda congelado
      const isFrozen = await isPayrollPeriodFrozen(ctx.companyIdA, periodStart, periodEnd, tx);
      expect(isFrozen).toBe(true);

      // Una segunda corrida sobre el mismo período debe fallar por estar congelado
      await expect(
        executePayrollRun(ctx.companyIdA, periodStart, periodEnd, ctx.userIdA, { dbInstance: tx })
      ).rejects.toThrow(/ya fue completado y se encuentra congelado/i);
    });
  });

  it("NOM-02.b V2: Solicitud de horas extra rechazada en shift_approvals produce pago 0", async () => {
    await runWithIsolation(async (tx, ctx) => {
      const periodStart = "2026-05-01";
      const periodEnd = "2026-05-15";

      // 1. Insertar sesión que requería aprobación
      const [session] = await tx
        .insert(shiftSessions)
        .values({
          userId: ctx.userIdA,
          branchId: ctx.branchIdA,
          status: "COMPLETED",
          requiresApproval: true,
          startedAt: new Date("2026-05-04T14:00:00Z"),
          overtimeMinutes: 180,
        })
        .returning();

      // 2. Insertar solicitud de aprobación en estado REJECTED
      await tx.insert(shiftApprovals).values({
        companyId: ctx.companyIdA,
        branchId: ctx.branchIdA,
        approvalType: "OVERTIME",
        requestedBy: ctx.userIdA,
        requestedFor: ctx.userIdA,
        shiftSessionId: session.id,
        title: "Horas extra del 4 de mayo",
        overtimeMinutes: 180,
        status: "REJECTED",
        approvedBy: ctx.userIdA,
        approvedAt: new Date("2026-05-05T10:00:00Z"),
        rejectionReason: "Presupuesto de horas extra excedido para esta semana",
      });

      // 3. Ejecutar cálculo: las horas rechazadas no deben generar costo laboral
      const payroll = await calculateEmployeePayroll(ctx.userIdA, periodStart, periodEnd, {
        dbInstance: tx,
      });

      expect(payroll.overtimePayCents).toBe(0);
      expect(payroll.overtimeBreakdown.hasOvertime).toBe(false);
      expect(payroll.overtimeBreakdown.rejectedCount).toBe(1);
      expect(payroll.totalPercepcionesCents).toBe(payroll.baseSalaryCents);
    });
  });

  it("NOM-02.b V2: Aislamiento multi-empresa de horas extra bajo pulso_app (NOBYPASSRLS)", async () => {
    await runWithIsolation(async (tx, ctx) => {
      const periodStart = "2026-05-01";
      const periodEnd = "2026-05-15";

      // 1. Con contexto de Empresa A, intentar insertar corrida para Empresa B se rechaza por RLS
      await tx.execute(sql.raw("SAVEPOINT forbidden_payroll_run_insert"));
      let errorCode: string | undefined;
      try {
        await tx.insert(payrollRuns).values({
          companyId: ctx.companyIdB,
          periodStart: "2026-05-01",
          periodEnd: "2026-05-15",
          status: "COMPLETED",
        });
      } catch (error: unknown) {
        const failure = error as { code?: string; cause?: { code?: string } };
        errorCode = failure.cause?.code || failure.code;
      }
      await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT forbidden_payroll_run_insert"));
      expect(errorCode).toBe("42501");

      // 2. Insertar turno con horas extra en Empresa A (3h extra = 37,500¢)
      await tx.insert(shiftSessions).values({
        userId: ctx.userIdA,
        branchId: ctx.branchIdA,
        status: "COMPLETED",
        requiresApproval: false,
        startedAt: new Date("2026-05-04T14:00:00Z"),
        overtimeMinutes: 180,
      });

      // 3. Bajo contexto de Empresa A, intentar calcular nómina de empleado B se bloquea
      // porque el usuario B no es accesible bajo el contexto de empresa A
      await expect(
        calculateEmployeePayroll(ctx.userIdB, periodStart, periodEnd, { dbInstance: tx })
      ).rejects.toThrow(/no tiene contrato vigente|no encontrado o sin empresa asignada/i);

      // 4. El cálculo para el empleado A solo incluye sus propias 3h extra (37,500¢)
      const payrollA = await calculateEmployeePayroll(ctx.userIdA, periodStart, periodEnd, {
        dbInstance: tx,
      });
      expect(payrollA.overtimePayCents).toBe(37500);
      expect(payrollA.totalPercepcionesCents).toBe(payrollA.baseSalaryCents + 37500);
    });
  });

  describe("NOM-02.c1 V2: Vacaciones, saldos, prima vacacional y RLS en Postgres aislado", () => {
    it("NOM-02.c1 V2: Cálculo de vacaciones autorizadas y prima vacacional 25% LFT desde Postgres real", async () => {
      await runWithIsolation(async (tx, ctx) => {
        const periodStart = "2026-05-01";
        const periodEnd = "2026-05-15";

        // 1. Insertar saldo acumulado de 12 días en vacation_accruals
        await tx.insert(vacationAccruals).values({
          userId: ctx.userIdA,
          companyId: ctx.companyIdA,
          year: 2026,
          daysAccrued: 12,
          daysTaken: 0,
          daysBalance: 12,
          yearsOfService: 1,
          applicableLawDays: 12,
          periodStart: new Date("2026-01-01T12:00:00Z"),
          periodEnd: new Date("2026-12-31T12:00:00Z"),
        });

        // 2. Insertar solicitud de vacaciones aprobada por 6 días (4 al 9 de mayo)
        await tx.insert(vacationRequests).values({
          companyId: ctx.companyIdA,
          branchId: ctx.branchIdA,
          userId: ctx.userIdA,
          startDate: new Date("2026-05-04T12:00:00Z"),
          endDate: new Date("2026-05-09T12:00:00Z"),
          totalDays: 6,
          status: "APPROVED",
          reason: "Vacaciones de ley año 1",
          approvedBy: ctx.userIdA,
          approvedAt: new Date("2026-05-01T12:00:00Z"),
        });

        // 3. Ejecutar cálculo de nómina en DB real
        const payroll = await calculateEmployeePayroll(ctx.userIdA, periodStart, periodEnd, {
          dbInstance: tx,
        });

        // Verificaciones
        expect(payroll.vacationDays).toBe(6);
        expect(payroll.vacationPrimeCents).toBe(75000); // 6 * 50,000 * 0.25 = 75,000¢
        expect(payroll.vacationBreakdown.vacationDaysEligible).toBe(6);
        expect(payroll.vacationBreakdown.vacationDaysExceeded).toBe(0);
        expect(payroll.vacationBreakdown.vacationRemainingBalance).toBe(6);
        expect(payroll.vacationBreakdown.justification).toBe("LFT_ARTS_76_80");
        expect(payroll.totalPercepcionesCents).toBe(payroll.baseSalaryCents + 75000);
        expect(payroll.attendanceBreakdown.vacationDays).toBe(6);
        expect(payroll.attendanceBreakdown.payableDays).toBe(15);
      });
    });

    it("NOM-02.c1 V2: Validación de saldo de vacaciones en base de datos real (saldo parcial / excedido)", async () => {
      await runWithIsolation(async (tx, ctx) => {
        const periodStart = "2026-05-01";
        const periodEnd = "2026-05-15";

        // 1. Insertar saldo acumulado disponible de solo 3 días
        await tx.insert(vacationAccruals).values({
          userId: ctx.userIdA,
          companyId: ctx.companyIdA,
          year: 2026,
          daysAccrued: 12,
          daysTaken: 9,
          daysBalance: 3,
          yearsOfService: 1,
          applicableLawDays: 12,
          periodStart: new Date("2026-01-01T12:00:00Z"),
          periodEnd: new Date("2026-12-31T12:00:00Z"),
        });

        // 2. Insertar solicitud de vacaciones aprobada por 5 días (4 al 8 de mayo)
        await tx.insert(vacationRequests).values({
          companyId: ctx.companyIdA,
          branchId: ctx.branchIdA,
          userId: ctx.userIdA,
          startDate: new Date("2026-05-04T12:00:00Z"),
          endDate: new Date("2026-05-08T12:00:00Z"),
          totalDays: 5,
          status: "APPROVED",
          reason: "Solicitud con saldo parcial",
          approvedBy: ctx.userIdA,
          approvedAt: new Date("2026-05-01T12:00:00Z"),
        });

        // 3. Ejecutar cálculo
        const payroll = await calculateEmployeePayroll(ctx.userIdA, periodStart, periodEnd, {
          dbInstance: tx,
        });

        expect(payroll.vacationDays).toBe(5);
        expect(payroll.vacationBreakdown.vacationDaysEligible).toBe(3);
        expect(payroll.vacationBreakdown.vacationDaysExceeded).toBe(2);
        // Prima solo sobre los 3 días elegibles: 3 * 50,000 * 0.25 = 37,500¢
        expect(payroll.vacationPrimeCents).toBe(37500);
        expect(payroll.vacationBreakdown.vacationRemainingBalance).toBe(0);
        expect(payroll.vacationBreakdown.justification).toBe("EXCEEDED_VACATION_BALANCE");
        expect(payroll.totalPercepcionesCents).toBe(payroll.baseSalaryCents + 37500);
      });
    });

    it("NOM-02.c1 V2: Permiso sin goce descuenta sueldo base vs permiso con goce mantiene sueldo íntegro sin prima vacacional", async () => {
      await runWithIsolation(async (tx, ctx) => {
        const periodStart = "2026-05-01";
        const periodEnd = "2026-05-15";

        // 1. Crear tipos de permiso (con goce y sin goce)
        const leaveTypeIdPaid = randomUUID();
        const leaveTypeIdUnpaid = randomUUID();

        await tx.insert(leaveTypes).values([
          {
            id: leaveTypeIdPaid,
            companyId: ctx.companyIdA,
            name: "PATERNITY",
            isPaid: true,
            maxDaysPerYear: 15,
          },
          {
            id: leaveTypeIdUnpaid,
            companyId: ctx.companyIdA,
            name: "PERSONAL_UNPAID",
            isPaid: false,
            maxDaysPerYear: 30,
          },
        ]);

        // 2. Insertar permiso sin goce de 2 días (4 y 5 de mayo)
        await tx.insert(leaveRequests).values({
          companyId: ctx.companyIdA,
          branchId: ctx.branchIdA,
          userId: ctx.userIdA,
          leaveTypeId: leaveTypeIdUnpaid,
          startDate: new Date("2026-05-04T12:00:00Z"),
          endDate: new Date("2026-05-05T12:00:00Z"),
          totalDays: 2,
          status: "APPROVED",
          reason: "Asuntos personales sin goce",
          approvedBy: ctx.userIdA,
          approvedAt: new Date("2026-05-01T12:00:00Z"),
        });

        // 3. Insertar permiso con goce de 3 días (11 al 13 de mayo)
        await tx.insert(leaveRequests).values({
          companyId: ctx.companyIdA,
          branchId: ctx.branchIdA,
          userId: ctx.userIdA,
          leaveTypeId: leaveTypeIdPaid,
          startDate: new Date("2026-05-11T12:00:00Z"),
          endDate: new Date("2026-05-13T12:00:00Z"),
          totalDays: 3,
          status: "APPROVED",
          reason: "Paternidad con goce",
          approvedBy: ctx.userIdA,
          approvedAt: new Date("2026-05-01T12:00:00Z"),
        });

        // 4. Ejecutar cálculo
        const payroll = await calculateEmployeePayroll(ctx.userIdA, periodStart, periodEnd, {
          dbInstance: tx,
        });

        // Permiso con goce (3 días) + permiso sin goce (2 días):
        // Días pagaderos: 15 - 2 (sin goce) = 13 días
        expect(payroll.attendanceBreakdown.unpaidAbsenceDays).toBe(2);
        expect(payroll.attendanceBreakdown.payableDays).toBe(13);
        // Sueldo base deducido en 2 días: 13 * 50,000 = 650,000¢ (deducción de 100,000¢)
        expect(payroll.baseSalaryCents).toBe(650000);
        // Permisos no generan prima vacacional
        expect(payroll.vacationPrimeCents).toBe(0);
        expect(payroll.vacationDays).toBe(0);
        expect(payroll.totalPercepcionesCents).toBe(650000);
      });
    });

    it("NOM-02.c1 V2: Aislamiento multi-empresa de vacaciones y saldos bajo pulso_app (NOBYPASSRLS)", async () => {
      await runWithIsolation(async (tx, ctx) => {
        const periodStart = "2026-05-01";
        const periodEnd = "2026-05-15";

        // 1. Con contexto de Empresa A, intentar insertar corrida para Empresa B se bloquea por RLS
        await tx.execute(sql.raw("SAVEPOINT forbidden_payroll_run_insert"));
        let errorCodeRun: string | undefined;
        try {
          await tx.insert(payrollRuns).values({
            companyId: ctx.companyIdB,
            periodStart: "2026-05-01",
            periodEnd: "2026-05-15",
            status: "COMPLETED",
          });
        } catch (error: unknown) {
          const failure = error as { code?: string; cause?: { code?: string } };
          errorCodeRun = failure.cause?.code || failure.code;
        }
        await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT forbidden_payroll_run_insert"));
        expect(errorCodeRun).toBe("42501");

        // 2. Insertar vacaciones legítimas para Empresa A
        await tx.insert(vacationAccruals).values({
          userId: ctx.userIdA,
          companyId: ctx.companyIdA,
          year: 2026,
          daysAccrued: 10,
          daysBalance: 10,
          yearsOfService: 1,
          applicableLawDays: 12,
          periodStart: new Date("2026-01-01T12:00:00Z"),
          periodEnd: new Date("2026-12-31T12:00:00Z"),
        });

        await tx.insert(vacationRequests).values({
          companyId: ctx.companyIdA,
          branchId: ctx.branchIdA,
          userId: ctx.userIdA,
          startDate: new Date("2026-05-04T12:00:00Z"),
          endDate: new Date("2026-05-07T12:00:00Z"),
          totalDays: 4,
          status: "APPROVED",
          reason: "Vacaciones legítimas Empresa A",
        });

        // 3. Calcular nómina de Empresa A: procesa sus 4 días legítimos (50,000¢ prima)
        const payrollA = await calculateEmployeePayroll(ctx.userIdA, periodStart, periodEnd, {
          dbInstance: tx,
        });
        expect(payrollA.vacationDays).toBe(4);
        expect(payrollA.vacationPrimeCents).toBe(50000); // 4 * 50,000 * 0.25 = 50,000¢

        // 4. Intentar calcular nómina de usuario B bajo contexto A falla
        await expect(
          calculateEmployeePayroll(ctx.userIdB, periodStart, periodEnd, { dbInstance: tx })
        ).rejects.toThrow(/no tiene contrato vigente|no encontrado o sin empresa asignada/i);
      });
    });
  });
});
