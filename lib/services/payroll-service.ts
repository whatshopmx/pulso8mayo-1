import { db } from "@/lib/db";
import { 
  propinas, 
  propinaAsignaciones, 
  employeeProfiles, 
  employeeContracts, 
  shiftSessions,
  vacationRequests,
  leaveRequests,
  users,
  payrollRuns,
  payrollPayslips,
  holidays
} from "@/lib/db/schema";
import { eq, and, gte, lte, sum, desc } from "drizzle-orm";
import { timbrarNomina } from "./fiscal-service";
import type { NominaDeduccion, NominaPercepcion } from "./fiscal-service";
import { differenceInDays, parseISO } from "date-fns";

export interface PayrollPreStampingValidation {
  canStamp: boolean;
  totalActiveEmployees: number;
  verifiedEmployees: number;
  blockingErrorsCount: number;
  validationErrors: Array<{
    userId: string;
    employeeName: string;
    error: string;
    code: 'GHOST_EMPLOYEE' | 'MISSING_RFC' | 'MISSING_CURP' | 'NO_CONTRACT';
    severity: 'BLOCKING' | 'WARNING';
  }>;
  financialSummary: {
    totalGrossSalaryCents: number;
    totalTipsCents: number;
    totalEmployerSocialSecurityCents: number;
    totalRealLaborCostCents: number;
  };
}

export interface LFT2026BenefitsConfig {
  aguinaldoDays: number; // 15 (base LFT) up to 30 days
  vacationBonusPercent: number; // 25% (base LFT) up to 50%
  paternityLeaveDays: number; // 10 to 15 days
  bereavementLeaveDays: number; // 5 days (Duelo)
  preventiveMedicalLeaveDays: number; // 2-3 days for health checkups
  familyCareLeaveDays: number; // Up to 30 days for elder/ill relative care
}

export const DEFAULT_LFT2026_BENEFITS: LFT2026BenefitsConfig = {
  aguinaldoDays: 30, // Reforma LFT 2026 propuesta progresiva
  vacationBonusPercent: 50, // Reforma LFT 2026 prima vacacional
  paternityLeaveDays: 15, // Escenario recomendado IMCO / LFT
  bereavementLeaveDays: 5, // Licencia por duelo
  preventiveMedicalLeaveDays: 3, // Exámenes médicos preventivos
  familyCareLeaveDays: 30, // Cuidado de familiares con enfermedades graves
};

export function calculateLFT2026Benefits(
  dailySalaryMXN: number,
  tenureYears: number,
  config: LFT2026BenefitsConfig = DEFAULT_LFT2026_BENEFITS
) {
  const aguinaldoAmount = dailySalaryMXN * config.aguinaldoDays;
  // Vacaciones según Ley Dignas (12d año 1, +2d por año hasta 20d, luego +2d por cada 5 años)
  let vacationDays = 12 + Math.max(0, tenureYears - 1) * 2;
  if (tenureYears > 5) {
    vacationDays = 20 + Math.floor((tenureYears - 5) / 5) * 2;
  }
  const vacationBonusAmount = (dailySalaryMXN * vacationDays) * (config.vacationBonusPercent / 100);

  return {
    dailySalaryMXN,
    tenureYears,
    vacationDays,
    aguinaldoAmount: Math.round(aguinaldoAmount * 100) / 100,
    vacationBonusAmount: Math.round(vacationBonusAmount * 100) / 100,
    totalAnnualBenefitsCost: Math.round((aguinaldoAmount + vacationBonusAmount) * 100) / 100,
  };
}

/**
 * Valida checadas de turno, detecta empleados fantasma y calcula la carga social patronal real
 * antes de permitir el timbrado fiscal o dispersión (Módulo 7.1, 7.2 & 7.3).
 */
export async function validatePayrollPreStamping(
  companyId: string,
  startDate: string,
  endDate: string,
  branchId?: string
): Promise<PayrollPreStampingValidation> {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const activeStaff = await db
    .select({
      userId: users.id,
      name: users.name,
      rfc: employeeProfiles.rfc,
      curp: employeeProfiles.curp,
      nss: employeeProfiles.nss,
      employeeNumber: employeeProfiles.employeeNumber,
      baseSalary: employeeContracts.baseSalary,
    })
    .from(users)
    .innerJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
    .leftJoin(employeeContracts, and(
      eq(users.id, employeeContracts.userId),
      eq(employeeContracts.status, 'ACTIVE')
    ))
    .where(
      and(
        eq(users.companyId, companyId),
        eq(employeeProfiles.isActive, true),
        ...(branchId ? [eq(users.branchId, branchId)] : [])
      )
    );

  const validationErrors: PayrollPreStampingValidation["validationErrors"] = [];
  let totalGrossSalaryCents = 0;
  const totalTipsCents = 0;
  let verifiedEmployees = 0;

  for (const emp of activeStaff) {
    let hasBlockingError = false;

    // Check RFC
    if (!emp.rfc || emp.rfc.trim().length < 12) {
      validationErrors.push({
        userId: emp.userId,
        employeeName: emp.name || "Sin Nombre",
        error: `RFC inválido o no configurado para timbrado CFDI 4.0 (${emp.rfc || "VACÍO"}).`,
        code: "MISSING_RFC",
        severity: "BLOCKING",
      });
      hasBlockingError = true;
    }

    // Check CURP
    if (!emp.curp || emp.curp.trim().length < 18) {
      validationErrors.push({
        userId: emp.userId,
        employeeName: emp.name || "Sin Nombre",
        error: `CURP incompleta (${emp.curp || "VACÍO"}).`,
        code: "MISSING_CURP",
        severity: "WARNING",
      });
    }

    // Check Contract
    if (!emp.baseSalary) {
      validationErrors.push({
        userId: emp.userId,
        employeeName: emp.name || "Sin Nombre",
        error: "Empleado activo sin contrato vigente o salario base registrado.",
        code: "NO_CONTRACT",
        severity: "BLOCKING",
      });
      hasBlockingError = true;
    }

    // Check Attendance Sessions vs Vacations/Leaves (Detección de Empleados Fantasma)
    const sessions = await db
      .select({ id: shiftSessions.id })
      .from(shiftSessions)
      .where(
        and(
          eq(shiftSessions.userId, emp.userId),
          gte(shiftSessions.startedAt, start),
          lte(shiftSessions.startedAt, end)
        )
      );

    const vacations = await db
      .select({ id: vacationRequests.id })
      .from(vacationRequests)
      .where(
        and(
          eq(vacationRequests.userId, emp.userId),
          eq(vacationRequests.status, "APPROVED"),
          gte(vacationRequests.startDate, start),
          lte(vacationRequests.startDate, end)
        )
      );

    if (sessions.length === 0 && vacations.length === 0) {
      validationErrors.push({
        userId: emp.userId,
        employeeName: emp.name || "Sin Nombre",
        error: `Alerta antifraude: Empleado sin checadas registradas en el período ni vacaciones/incidencias aprobadas (Posible empleado fantasma).`,
        code: "GHOST_EMPLOYEE",
        severity: "BLOCKING",
      });
      hasBlockingError = true;
    }

    if (!hasBlockingError) {
      verifiedEmployees++;
    }

    // Aggregate financial amounts
    const daysInPeriod = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
    const baseCents = (emp.baseSalary || 0) * daysInPeriod;
    totalGrossSalaryCents += baseCents;
  }

  // Carga social patronal estimada (IMSS + Infonavit + ISN = 35% del salario base) (Módulo 7.3)
  const totalEmployerSocialSecurityCents = Math.round(totalGrossSalaryCents * 0.35);
  const totalRealLaborCostCents = totalGrossSalaryCents + totalEmployerSocialSecurityCents + totalTipsCents;

  const blockingErrorsCount = validationErrors.filter((e) => e.severity === "BLOCKING").length;

  return {
    canStamp: blockingErrorsCount === 0,
    totalActiveEmployees: activeStaff.length,
    verifiedEmployees,
    blockingErrorsCount,
    validationErrors,
    financialSummary: {
      totalGrossSalaryCents,
      totalTipsCents,
      totalEmployerSocialSecurityCents,
      totalRealLaborCostCents,
    },
  };
}

export async function calculateEmployeePayroll(userId: string, startDate: string, endDate: string) {
  // 1. Calculate tips
  const propinasSum = await db
    .select({
      totalTips: sum(propinaAsignaciones.assignedAmountCents)
    })
    .from(propinaAsignaciones)
    .innerJoin(propinas, eq(propinaAsignaciones.propinaId, propinas.id))
    .where(
      and(
        eq(propinaAsignaciones.userId, userId),
        gte(propinas.businessDate, startDate),
        lte(propinas.businessDate, endDate)
      )
    );
    
  const tipsCents = Number(propinasSum[0]?.totalTips || 0);

  // 2. Base salary
  const contract = await db.select()
    .from(employeeContracts)
    .where(eq(employeeContracts.userId, userId))
    .limit(1)
    .then(res => res[0]);

  // simple calculation: base salary (daily) * days in period
  const daysInPeriod = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
  const baseSalaryCents = (contract?.baseSalary || 0) * daysInPeriod;

  // 3. Holiday extra pay (LFT Art. 75): Salario doble ADICIONAL por laborar en día de descanso obligatorio
  let holidayPayCents = 0;
  let holidayDaysWorked = 0;

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { companyId: true }
  });

  if (user?.companyId && contract?.baseSalary) {
    const holidayList = await db
      .select({
        date: holidays.date,
        isMandatory: holidays.isMandatory
      })
      .from(holidays)
      .where(
        and(
          eq(holidays.companyId, user.companyId),
          gte(holidays.date, startDate),
          lte(holidays.date, endDate)
        )
      );

    const holidaySet = new Set(
      holidayList
        .filter((h) => h.isMandatory !== false)
        .map((h) => (typeof h.date === "string" ? h.date.slice(0, 10) : new Date(h.date).toISOString().slice(0, 10)))
    );

    if (holidaySet.size > 0) {
      const periodStart = new Date(`${startDate}T00:00:00`);
      const periodEnd = new Date(`${endDate}T23:59:59`);

      const sessions = await db
        .select({
          startedAt: shiftSessions.startedAt,
        })
        .from(shiftSessions)
        .where(
          and(
            eq(shiftSessions.userId, userId),
            eq(shiftSessions.status, "COMPLETED"),
            gte(shiftSessions.startedAt, periodStart),
            lte(shiftSessions.startedAt, periodEnd)
          )
        );

      const workedDays = new Set<string>();
      for (const s of sessions) {
        if (s.startedAt) {
          const day = new Date(s.startedAt).toISOString().slice(0, 10);
          if (holidaySet.has(day)) {
            workedDays.add(day);
          }
        }
      }

      holidayDaysWorked = workedDays.size;
      // Salario doble adicional por cada festivo trabajado (Art. 75 LFT)
      holidayPayCents = holidayDaysWorked * contract.baseSalary * 2;
    }
  }

  const totalPercepcionesCents = baseSalaryCents + tipsCents + holidayPayCents;

  // Carga Patronal Real (35% IMSS/Infonavit/ISN sobre base + festivos) (Módulo 7.3)
  const employerSocialSecurityCents = Math.round((baseSalaryCents + holidayPayCents) * 0.35);
  const realLaborCostCents = totalPercepcionesCents + employerSocialSecurityCents;

  return {
    baseSalaryCents,
    propinasCents: tipsCents,
    holidayPayCents,
    overtimePayCents: 0,
    holidayDaysWorked,
    totalPercepcionesCents,
    totalDeduccionesCents: 0,
    employerSocialSecurityCents,
    realLaborCostCents,
    /** Datos reales del contrato para el CFDI (SBC y fecha de contratación). */
    salarioDiarioCents: contract?.baseSalary || 0,
    fechaContratacion: contract?.startDate
      ? new Date(contract.startDate).toISOString().slice(0, 10)
      : undefined,
  };
}

/**
 * Desglose fiscal del período para el CFDI de nómina.
 *
 * El sueldo va como "001 Sueldos" gravado; las propinas asignadas NO son
 * salario (LFT art. 87) y el catálogo `c_TipoPercepcion` no les da clave
 * propia, así que van como "038 Otros ingresos por salarios" exentas de ISR.
 * La prima de festivo trabajado va como "025 Día festivo" conforme a LISR art. 93.
 */
export function construirDesgloseNomina(payroll: {
  baseSalaryCents: number;
  propinasCents: number;
  holidayPayCents?: number;
}): {
  desglosePercepciones: NominaPercepcion[];
  desgloseDeducciones: NominaDeduccion[];
} {
  const desglosePercepciones: NominaPercepcion[] = [
    {
      earningTypeCode: "001",
      code: "001",
      concept: "Sueldo nominal",
      taxedAmount: payroll.baseSalaryCents,
      exemptAmount: 0,
    },
  ];
  if (payroll.propinasCents > 0) {
    desglosePercepciones.push({
      earningTypeCode: "038",
      code: "038",
      concept: "Propinas asignadas",
      taxedAmount: 0,
      exemptAmount: payroll.propinasCents,
    });
  }
  if (payroll.holidayPayCents && payroll.holidayPayCents > 0) {
    // LISR Art. 93 Fracción I: Tratamiento fiscal del pago por festivo trabajado
    // 50% exento topado a 5 veces la UMA diaria
    const UMA_DIARIA_CENTS_2026 = 11314;
    const maxExempt = 5 * UMA_DIARIA_CENTS_2026;
    const half = Math.floor(payroll.holidayPayCents / 2);
    const exemptAmount = Math.min(half, maxExempt);
    const taxedAmount = payroll.holidayPayCents - exemptAmount;

    desglosePercepciones.push({
      earningTypeCode: "025",
      code: "025",
      concept: "Prima por día festivo trabajado (Art. 75 LFT)",
      taxedAmount,
      exemptAmount,
    });
  }
  return { desglosePercepciones, desgloseDeducciones: [] };
}

export async function executePayrollRun(
  companyId: string,
  startDate: string,
  endDate: string,
  /** Quién corrió la nómina. Viaja al timbrado, que ahora deja constancia. */
  performedBy?: string
) {
  // 0. Pre-Flight Validation Check (Módulo 7.1 & 7.2)
  const validation = await validatePayrollPreStamping(companyId, startDate, endDate);
  if (!validation.canStamp) {
    const errorDetails = validation.validationErrors
      .filter((e) => e.severity === "BLOCKING")
      .map((e) => `${e.employeeName}: ${e.error}`)
      .join("; ");
    throw new Error(
      `Bloqueo de Nómina Pre-Timbrado: Existen ${validation.blockingErrorsCount} incidencias bloqueantes. [${errorDetails}]`
    );
  }

  // 1. Create a payroll run
  const [run] = await db.insert(payrollRuns).values({
    companyId,
    periodStart: startDate,
    periodEnd: endDate,
    status: 'PROCESSING'
  }).returning();

  // 2. Get all active employees in company
  const activeStaff = await db
    .select({
      userId: users.id,
      name: users.name,
      rfc: employeeProfiles.rfc,
      curp: employeeProfiles.curp,
      nss: employeeProfiles.nss,
    })
    .from(users)
    .innerJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
    .where(
      and(
        eq(users.companyId, companyId),
        eq(employeeProfiles.isActive, true)
      )
    );

  const results = [];

  for (const emp of activeStaff) {
    try {
      if (!emp.rfc) {
         throw new Error(`Empleado ${emp.name} no tiene RFC configurado.`);
      }

      const payrollCalc = await calculateEmployeePayroll(emp.userId, startDate, endDate);
      const desglose = construirDesgloseNomina(payrollCalc);
      
      // Timbrar nómina
      const timbrado = await timbrarNomina({
        companyId,
        performedBy,
        empleadoRfc: emp.rfc,
        empleadoNombre: emp.name || "Sin Nombre",
        empleadoCurp: emp.curp || "",
        empleadoNss: emp.nss || "",
        empleadoFechaContratacion: payrollCalc.fechaContratacion,
        empleadoSalarioDiarioCents: payrollCalc.salarioDiarioCents,
        periodo: `${startDate} - ${endDate}`,
        totalPercepciones: payrollCalc.totalPercepcionesCents,
        totalDeducciones: payrollCalc.totalDeduccionesCents,
        ...desglose,
      });

      // Save payslip
      const [payslip] = await db.insert(payrollPayslips).values({
        runId: run.id,
        userId: emp.userId,
        baseSalaryCents: payrollCalc.baseSalaryCents,
        propinasCents: payrollCalc.propinasCents,
        holidayPayCents: payrollCalc.holidayPayCents,
        overtimePayCents: payrollCalc.overtimePayCents,
        totalPercepcionesCents: payrollCalc.totalPercepcionesCents,
        totalDeduccionesCents: payrollCalc.totalDeduccionesCents,
        cfdiUuid: timbrado.uuid,
        cfdiStatus: timbrado.status,
        selloDigital: timbrado.selloDigital,
      }).returning();
      
      results.push({ success: true, userId: emp.userId, payslip });
    } catch (err: any) {
      console.error(`Error procesando nómina para ${emp.userId}:`, err);
      results.push({ success: false, userId: emp.userId, error: err.message });
      // Guardar payslip con error
      const payrollCalc = await calculateEmployeePayroll(emp.userId, startDate, endDate);
      await db.insert(payrollPayslips).values({
        runId: run.id,
        userId: emp.userId,
        baseSalaryCents: payrollCalc.baseSalaryCents,
        propinasCents: payrollCalc.propinasCents,
        holidayPayCents: payrollCalc.holidayPayCents,
        overtimePayCents: payrollCalc.overtimePayCents,
        totalPercepcionesCents: payrollCalc.totalPercepcionesCents,
        totalDeduccionesCents: payrollCalc.totalDeduccionesCents,
        cfdiStatus: "ERROR",
      });
    }
  }

  // Update run status
  const hasErrors = results.some(r => !r.success);
  await db.update(payrollRuns).set({
    status: hasErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED'
  }).where(eq(payrollRuns.id, run.id));

  return {
    runId: run.id,
    results
  };
}

export async function getPayrollRuns(companyId: string) {
  return await db.select()
    .from(payrollRuns)
    .where(eq(payrollRuns.companyId, companyId))
    .orderBy(desc(payrollRuns.periodStart));
}

export async function getPayrollPayslips(runId: string) {
  return await db.select({
    id: payrollPayslips.id,
    userId: payrollPayslips.userId,
    userName: users.name,
    baseSalaryCents: payrollPayslips.baseSalaryCents,
    propinasCents: payrollPayslips.propinasCents,
    holidayPayCents: payrollPayslips.holidayPayCents,
    overtimePayCents: payrollPayslips.overtimePayCents,
    totalPercepcionesCents: payrollPayslips.totalPercepcionesCents,
    cfdiUuid: payrollPayslips.cfdiUuid,
    cfdiStatus: payrollPayslips.cfdiStatus,
  })
  .from(payrollPayslips)
  .innerJoin(users, eq(payrollPayslips.userId, users.id))
  .where(eq(payrollPayslips.runId, runId));
}
