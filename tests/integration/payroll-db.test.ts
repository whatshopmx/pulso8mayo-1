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
  holidays,
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
      "holidays",
      "leave_types",
      "leave_requests",
      "vacation_requests",
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
});
