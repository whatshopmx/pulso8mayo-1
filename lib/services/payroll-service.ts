import { db } from "@/lib/db";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { ApiError } from "@/lib/api/error";
import { 
  propinas, 
  propinaAsignaciones, 
  employeeProfiles, 
  employeeContracts, 
  salaryHistory,
  shiftSessions,
  vacationRequests,
  users,
  payrollRuns,
  payrollPayslips,
  holidays
} from "@/lib/db/schema";
import { eq, and, gte, lte, sum, desc } from "drizzle-orm";
import { timbrarNomina } from "./fiscal-service";
import type { NominaDeduccion, NominaPercepcion } from "./fiscal-service";
import { calcularAguinaldoAnual, DIAS_PRORRATEO } from "./aguinaldo-service";
import { capturePayrollRunIn } from "./accounting/payroll-adapter";
import { isAccountingPostingEnabled } from "./accounting/expense-adapter";
import { AGUINALDO_DAYS_VIGENTE } from "@/lib/company/labor-reform-status-catalog";
import { differenceInDays, parseISO, addDays, format } from "date-fns";

export interface ValidatedPayrollPeriod {
  startDate: string;
  endDate: string;
  calendarDays: number;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida un período de nómina según calendario.
 * Exige formato YYYY-MM-DD y que startDate <= endDate.
 */
export function validatePayrollPeriod(startDate: string, endDate: string): ValidatedPayrollPeriod {
  if (!startDate || !endDate || !ISO_DATE_REGEX.test(startDate) || !ISO_DATE_REGEX.test(endDate)) {
    throw new RangeError("Periodo de nómina inválido: las fechas deben tener formato YYYY-MM-DD.");
  }
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || startDate > endDate) {
    throw new RangeError("Periodo de nómina inválido: la fecha de inicio no puede ser posterior a la fecha de fin.");
  }
  const calendarDays = differenceInDays(end, start) + 1;
  return { startDate, endDate, calendarDays };
}

export interface ContractSalaryResolutionInput {
  contract: {
    id: string;
    userId: string;
    contractNumber?: string | null;
    baseSalary: number; // Sueldo diario en centavos
    currency?: string | null;
    workRegime?: string | null;
    startDate: Date | string;
    endDate?: Date | string | null;
    status?: string | null;
  };
  salaryHistory?: Array<{
    id?: string;
    contractId?: string | null;
    newSalary: number; // Sueldo diario en centavos
    previousSalary?: number | null;
    effectiveDate: Date | string;
  }>;
  periodStart: string;
  periodEnd: string;
}

export interface ContractSalaryResolution {
  userId: string;
  contractId: string;
  currency: string;
  dailySalaryCents: number; // Salario diario vigente al cierre del período
  periodicity: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  contractStartDate: string;
  contractEndDate: string | null;
  overlapStartDate: string;
  overlapEndDate: string;
  calendarDaysInPeriod: number;
  effectiveDaysInPeriod: number;
  baseSalaryCents: number; // Total devengado en centavos en el período
  isProrated: boolean;
  salaryChangesApplied: number;
}

function toIsoDate(d: Date | string): string {
  if (typeof d === "string") {
    return d.slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Resuelve el contrato salarial y las vigencias temporales efectivas para un período calendario.
 * - Verifica moneda soportada (MXN).
 * - Rechaza salarios <= 0 o contratos no vigentes en el período.
 * - Prorratea días si el inicio/fin del contrato corta el período.
 * - Aplica historial salarial según fechas efectivas; cambios posteriores al período se ignoran.
 */
export function resolveContractSalaryForPeriod(
  input: ContractSalaryResolutionInput
): ContractSalaryResolution {
  const { contract, salaryHistory: historyList = [], periodStart, periodEnd } = input;

  const { calendarDays } = validatePayrollPeriod(periodStart, periodEnd);

  const currency = (contract.currency || "MXN").trim().toUpperCase();
  if (currency !== "MXN") {
    throw new Error(`Moneda no soportada (${contract.currency}). Solo se admite MXN.`);
  }

  if (typeof contract.baseSalary !== "number" || contract.baseSalary <= 0) {
    throw new Error("El salario base del contrato debe ser mayor a cero.");
  }

  const contractStart = toIsoDate(contract.startDate);
  const contractEnd = contract.endDate ? toIsoDate(contract.endDate) : null;

  if (contractStart > periodEnd) {
    throw new Error(
      `El contrato no estuvo vigente durante el período (inicio de contrato ${contractStart} posterior a fin de período ${periodEnd}).`
    );
  }

  if (contractEnd && contractEnd < periodStart) {
    throw new Error(
      `El contrato no estuvo vigente durante el período (fin de contrato ${contractEnd} anterior a inicio de período ${periodStart}).`
    );
  }

  const overlapStart = contractStart > periodStart ? contractStart : periodStart;
  const overlapEnd = contractEnd && contractEnd < periodEnd ? contractEnd : periodEnd;

  const startDayDate = parseISO(overlapStart);
  const endDayDate = parseISO(overlapEnd);
  const effectiveDaysInPeriod = differenceInDays(endDayDate, startDayDate) + 1;

  if (effectiveDaysInPeriod <= 0) {
    throw new Error("El contrato no estuvo vigente durante el período.");
  }

  // Ordenar todo el historial salarial cronológicamente por fecha efectiva
  const sortedHistory = historyList
    .map((h) => ({
      ...h,
      effectiveDateStr: toIsoDate(h.effectiveDate),
    }))
    .sort((a, b) => a.effectiveDateStr.localeCompare(b.effectiveDateStr));

  let totalBaseSalaryCents = 0;
  const appliedChangeDates = new Set<string>();
  let lastDailySalary = contract.baseSalary;

  for (let i = 0; i < effectiveDaysInPeriod; i++) {
    const currentDayDate = addDays(startDayDate, i);
    const dayStr = format(currentDayDate, "yyyy-MM-dd");

    // Salario aplicable en el día calendario dayStr:
    // 1. Si hay registros en el historial con fecha efectiva <= dayStr, tomamos el más reciente.
    // 2. Si no hay registros <= dayStr (todos son futuros respecto a dayStr), tomamos el previousSalary
    //    del primer cambio futuro si existe; de lo contrario el baseSalary del contrato.
    let applicableSalary = contract.baseSalary;
    const pastChanges = sortedHistory.filter((h) => h.effectiveDateStr <= dayStr);
    if (pastChanges.length > 0) {
      const latestPast = pastChanges[pastChanges.length - 1];
      applicableSalary = latestPast.newSalary;
      if (latestPast.effectiveDateStr >= overlapStart && latestPast.effectiveDateStr <= overlapEnd) {
        appliedChangeDates.add(latestPast.effectiveDateStr);
      }
    } else {
      const futureChanges = sortedHistory.filter((h) => h.effectiveDateStr > dayStr);
      if (futureChanges.length > 0 && typeof futureChanges[0].previousSalary === "number") {
        applicableSalary = futureChanges[0].previousSalary;
      }
    }

    totalBaseSalaryCents += applicableSalary;
    lastDailySalary = applicableSalary;
  }

  let periodicity: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" = "BIWEEKLY";
  if (contract.workRegime === "DAILY" || calendarDays <= 1) {
    periodicity = "DAILY";
  } else if (contract.workRegime === "WEEKLY" || calendarDays === 7) {
    periodicity = "WEEKLY";
  } else if (calendarDays >= 28) {
    periodicity = "MONTHLY";
  }

  const isProrated = effectiveDaysInPeriod < calendarDays;

  return {
    userId: contract.userId,
    contractId: contract.id,
    currency,
    dailySalaryCents: lastDailySalary,
    periodicity,
    contractStartDate: contractStart,
    contractEndDate: contractEnd,
    overlapStartDate: overlapStart,
    overlapEndDate: overlapEnd,
    calendarDaysInPeriod: calendarDays,
    effectiveDaysInPeriod,
    baseSalaryCents: totalBaseSalaryCents,
    isProrated,
    salaryChangesApplied: appliedChangeDates.size,
  };
}

/**
 * Determina si un período de nómina ya está completado y por tanto congelado e inmutable.
 */
export async function isPayrollPeriodFrozen(
  companyId: string,
  startDate: string,
  endDate: string,
  dbInstance = db
): Promise<boolean> {
  const [completed] = await dbInstance
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.companyId, companyId),
        eq(payrollRuns.periodStart, startDate),
        eq(payrollRuns.periodEnd, endDate),
        eq(payrollRuns.status, "COMPLETED")
      )
    )
    .limit(1);

  return Boolean(completed);
}

export interface PayrollPreStampingValidation {
  canStamp: boolean;
  totalActiveEmployees: number;
  verifiedEmployees: number;
  blockingErrorsCount: number;
  validationErrors: Array<{
    userId: string;
    employeeName: string;
    error: string;
    code: 'GHOST_EMPLOYEE' | 'MISSING_RFC' | 'MISSING_CURP' | 'NO_CONTRACT' | 'UNSUPPORTED_CURRENCY' | 'INVALID_SALARY' | 'INACTIVE_CONTRACT_PERIOD' | 'PERIOD_ALREADY_COMPLETED' | 'INVALID_PERIOD' | string;
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
  aguinaldoDays: number; // Vigente: 15 (Art. 87); 30 días = AGUINALDO_30_DIAS, PENDING_INITIATIVE (proyección)
  vacationBonusPercent: number; // 25% (base LFT) up to 50%
  paternityLeaveDays: number; // 10 to 15 days
  bereavementLeaveDays: number; // 5 days (Duelo)
  preventiveMedicalLeaveDays: number; // 2-3 days for health checkups
  familyCareLeaveDays: number; // Up to 30 days for elder/ill relative care
  /** Días trabajados del año fiscal (prorrateo opcional); fuera → año completo. */
  diasLaborados?: number;
}

export const DEFAULT_LFT2026_BENEFITS: LFT2026BenefitsConfig = {
  // [H04] La iniciativa de 30 días progresivos NO es ley (catálogo
  // AGUINALDO_30_DIAS). El default legal es 15 (Art. 87); para proyecciones
  // a 30 días, pasar config explícita y exponer aguinaldoEstatusLegal.
  aguinaldoDays: AGUINALDO_DAYS_VIGENTE,
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
  // Aguinaldo resuelto por el servicio compartido (línea única de verdad):
  // Art. 87 prorrateado, montos en centavos. Proyección anual → año completo
  // si no viene diasLaborados.
  const aguinaldo = calcularAguinaldoAnual({
    anioFiscal: new Date().getFullYear(),
    salarioDiarioCents: Math.round(dailySalaryMXN * 100),
    diasLaborados: config.diasLaborados ?? DIAS_PRORRATEO,
    aguinaldoDaysMxn: config.aguinaldoDays,
  });
  const aguinaldoAmount = aguinaldo.brutoCents / 100;
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
    /** Estatus legal de los días usados ([H04]): LEY_VIGENTE a 15; PROYECCION si config > 15. */
    aguinaldoEstatusLegal: aguinaldo.estatusLegal,
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
  const validationErrors: PayrollPreStampingValidation["validationErrors"] = [];

  // 1. Validar fechas del calendario del período
  try {
    validatePayrollPeriod(startDate, endDate);
  } catch (err: any) {
    validationErrors.push({
      userId: "PERIOD_CHECK",
      employeeName: "Período de Nómina",
      error: err.message,
      code: "INVALID_PERIOD",
      severity: "BLOCKING",
    });
    return {
      canStamp: false,
      totalActiveEmployees: 0,
      verifiedEmployees: 0,
      blockingErrorsCount: 1,
      validationErrors,
      financialSummary: {
        totalGrossSalaryCents: 0,
        totalTipsCents: 0,
        totalEmployerSocialSecurityCents: 0,
        totalRealLaborCostCents: 0,
      },
    };
  }

  // 2. Verificar si el período ya fue completado y está congelado
  const isFrozen = await isPayrollPeriodFrozen(companyId, startDate, endDate);
  if (isFrozen) {
    validationErrors.push({
      userId: "PERIOD_CHECK",
      employeeName: "Período de Nómina",
      error: `El período de nómina ${startDate} - ${endDate} ya fue completado y se encuentra congelado.`,
      code: "PERIOD_ALREADY_COMPLETED",
      severity: "BLOCKING",
    });
  }

  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const activeStaff = await db
    .select({
      userId: users.id,
      name: users.name,
      rfc: employeeProfiles.rfc,
      curp: employeeProfiles.curp,
      nss: employeeProfiles.nss,
      employeeNumber: employeeProfiles.employeeNumber,
      contractId: employeeContracts.id,
      baseSalary: employeeContracts.baseSalary,
      currency: employeeContracts.currency,
      contractStartDate: employeeContracts.startDate,
      contractEndDate: employeeContracts.endDate,
      contractStatus: employeeContracts.status,
    })
    .from(users)
    .innerJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
    .leftJoin(employeeContracts, and(
      eq(users.id, employeeContracts.userId),
      eq(employeeContracts.companyId, companyId),
      eq(employeeContracts.status, 'ACTIVE')
    ))
    .where(
      and(
        eq(users.companyId, companyId),
        eq(employeeProfiles.isActive, true),
        ...(branchId ? [eq(users.branchId, branchId)] : [])
      )
    );

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
    if (!emp.contractId || !emp.baseSalary) {
      validationErrors.push({
        userId: emp.userId,
        employeeName: emp.name || "Sin Nombre",
        error: "Empleado activo sin contrato vigente o salario base registrado.",
        code: "NO_CONTRACT",
        severity: "BLOCKING",
      });
      hasBlockingError = true;
    } else {
      const currency = (emp.currency || "MXN").trim().toUpperCase();
      if (currency !== "MXN") {
        validationErrors.push({
          userId: emp.userId,
          employeeName: emp.name || "Sin Nombre",
          error: `Moneda de contrato no soportada (${emp.currency}). Solo se admite MXN.`,
          code: "UNSUPPORTED_CURRENCY",
          severity: "BLOCKING",
        });
        hasBlockingError = true;
      }

      if (emp.baseSalary <= 0) {
        validationErrors.push({
          userId: emp.userId,
          employeeName: emp.name || "Sin Nombre",
          error: "El salario base registrado en el contrato debe ser mayor a cero.",
          code: "INVALID_SALARY",
          severity: "BLOCKING",
        });
        hasBlockingError = true;
      }

      try {
        const res = resolveContractSalaryForPeriod({
          contract: {
            id: emp.contractId,
            userId: emp.userId,
            baseSalary: emp.baseSalary,
            currency: emp.currency,
            startDate: emp.contractStartDate!,
            endDate: emp.contractEndDate,
          },
          periodStart: startDate,
          periodEnd: endDate,
        });
        totalGrossSalaryCents += res.baseSalaryCents;
      } catch (err: any) {
        validationErrors.push({
          userId: emp.userId,
          employeeName: emp.name || "Sin Nombre",
          error: err.message,
          code: "INACTIVE_CONTRACT_PERIOD",
          severity: "BLOCKING",
        });
        hasBlockingError = true;
      }
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
  // 0. Validar período y usuario
  const { calendarDays } = validatePayrollPeriod(startDate, endDate);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, companyId: true, name: true }
  });

  if (!user || !user.companyId) {
    throw new Error(`Empleado ${userId} no encontrado o sin empresa asignada.`);
  }

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

  // 2. Base salary & Contract Resolution
  const contracts = await db
    .select()
    .from(employeeContracts)
    .where(
      and(
        eq(employeeContracts.userId, userId),
        eq(employeeContracts.companyId, user.companyId),
        eq(employeeContracts.status, 'ACTIVE')
      )
    )
    .orderBy(desc(employeeContracts.startDate));

  if (!contracts || contracts.length === 0) {
    throw new Error(`Empleado ${user.name || userId} no tiene contrato vigente para el período ${startDate} - ${endDate}.`);
  }

  const contract = contracts[0];

  // Historial salarial hasta el fin del período (cambios posteriores no alteran este período)
  const history = await db
    .select({
      id: salaryHistory.id,
      contractId: salaryHistory.contractId,
      newSalary: salaryHistory.newSalary,
      previousSalary: salaryHistory.previousSalary,
      effectiveDate: salaryHistory.effectiveDate,
    })
    .from(salaryHistory)
    .where(
      and(
        eq(salaryHistory.userId, userId),
        lte(salaryHistory.effectiveDate, new Date(`${endDate}T23:59:59Z`))
      )
    )
    .orderBy(desc(salaryHistory.effectiveDate));

  const contractResolution = resolveContractSalaryForPeriod({
    contract,
    salaryHistory: history,
    periodStart: startDate,
    periodEnd: endDate,
  });

  const baseSalaryCents = contractResolution.baseSalaryCents;
  const salarioDiarioCents = contractResolution.dailySalaryCents;

  // 3. Holiday extra pay (LFT Art. 75): Salario doble ADICIONAL por laborar en día de descanso obligatorio
  let holidayPayCents = 0;
  let holidayDaysWorked = 0;

  if (contractResolution.baseSalaryCents > 0) {
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
      holidayPayCents = holidayDaysWorked * salarioDiarioCents * 2;
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
    salarioDiarioCents,
    fechaContratacion: contract?.startDate
      ? new Date(contract.startDate).toISOString().slice(0, 10)
      : undefined,
    contractDetails: {
      contractId: contract.id,
      currency: contractResolution.currency,
      periodicity: contractResolution.periodicity,
      effectiveDays: contractResolution.effectiveDaysInPeriod,
      calendarDays,
      isProrated: contractResolution.isProrated,
      salaryChangesApplied: contractResolution.salaryChangesApplied,
    },
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
  validatePayrollPeriod(startDate, endDate);
  const isFrozen = await isPayrollPeriodFrozen(companyId, startDate, endDate);
  if (isFrozen) {
    throw new Error(`El período de nómina ${startDate} - ${endDate} ya fue completado y se encuentra congelado.`);
  }

  const scope = { companyId, actorId: performedBy };
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
  const [run] = await withCompanyContext(scope, (tx) => tx.insert(payrollRuns).values({
    companyId,
    periodStart: startDate,
    periodEnd: endDate,
    status: 'PROCESSING'
  }).returning());

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
      const [payslip] = await withCompanyContext(scope, (tx) => tx.insert(payrollPayslips).values({
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
      }).returning());
      
      results.push({ success: true, userId: emp.userId, payslip });
    } catch (err: any) {
      console.error(`Error procesando nómina para ${emp.userId}:`, err);
      results.push({ success: false, userId: emp.userId, error: err.message });
      // Guardar payslip con error
      let payrollCalc: any = null;
      try {
        payrollCalc = await calculateEmployeePayroll(emp.userId, startDate, endDate);
      } catch {
        payrollCalc = null;
      }
      await withCompanyContext(scope, (tx) => tx.insert(payrollPayslips).values({
        runId: run.id,
        userId: emp.userId,
        baseSalaryCents: payrollCalc?.baseSalaryCents ?? 0,
        propinasCents: payrollCalc?.propinasCents ?? 0,
        holidayPayCents: payrollCalc?.holidayPayCents ?? 0,
        overtimePayCents: payrollCalc?.overtimePayCents ?? 0,
        totalPercepcionesCents: payrollCalc?.totalPercepcionesCents ?? 0,
        totalDeduccionesCents: payrollCalc?.totalDeduccionesCents ?? 0,
        cfdiStatus: "ERROR",
      }));
    }
  }

  // Update run status
  const hasErrors = results.some(r => !r.success);
  await withCompanyContext(scope, async (tx) => {
    await tx.update(payrollRuns).set({
      status: hasErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED'
    }).where(and(eq(payrollRuns.id, run.id), eq(payrollRuns.companyId, companyId)));
    if (!hasErrors) {
      if (isAccountingPostingEnabled() && !performedBy) {
        throw ApiError.forbidden("La contabilización de nómina requiere un actor autenticado.");
      }
      if (performedBy) {
        await capturePayrollRunIn(tx, companyId, performedBy, run.id);
      }
    }
  });

  return {
    runId: run.id,
    results
  };
}

export async function getPayrollRuns(companyId: string) {
  return withCompanyContext({ companyId }, (tx) => tx.select()
    .from(payrollRuns)
    .where(eq(payrollRuns.companyId, companyId))
    .orderBy(desc(payrollRuns.periodStart)));
}

export async function getPayrollPayslips(companyId: string, runId: string) {
  return withCompanyContext({ companyId }, async (tx) => {
    const [run] = await tx.select({ id: payrollRuns.id }).from(payrollRuns)
      .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).limit(1);
    if (!run) throw ApiError.notFound("Corrida de nómina no encontrada");
    return tx.select({
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
      .innerJoin(payrollRuns, eq(payrollPayslips.runId, payrollRuns.id))
      .innerJoin(users, and(eq(payrollPayslips.userId, users.id), eq(users.companyId, companyId)))
      .where(and(eq(payrollPayslips.runId, runId), eq(payrollRuns.companyId, companyId)));
  });
}
