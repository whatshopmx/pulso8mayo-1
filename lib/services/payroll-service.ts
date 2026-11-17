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
  shiftApprovals,
  vacationRequests,
  vacationAccruals,
  leaveRequests,
  leaveTypes,
  leaveBalances,
  branches,
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
import { differenceInDays, parseISO, addDays, format, startOfWeek } from "date-fns";
import { diaCivilEnZona } from "./aguinaldo-days-adapter";
import { resolveSeveranceMinimumWage, type MinimumWageZone } from "./severance-minimum-wage";

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

export interface OvertimeWeeklyBreakdown {
  calendarWeek: string; // e.g. "2026-W46" or "2026-05-04/2026-05-10"
  doubleMinutes: number;
  tripleMinutes: number;
  doublePayCents: number;
  triplePayCents: number;
}

export interface OvertimeBreakdown {
  totalMinutes: number;
  doubleMinutes: number;
  tripleMinutes: number;
  doublePayCents: number;
  triplePayCents: number;
  totalPayCents: number;
  hasOvertime: boolean;
  justification: string; // "SIN_HORAS_EXTRA" | "LFT_ARTS_66_67_68"
  weeklyBreakdown: OvertimeWeeklyBreakdown[];
  approvedSessionsCount: number;
  rejectedCount: number;
}

export interface ResolveOvertimeInput {
  userId: string;
  companyId: string;
  startDate: string;
  endDate: string;
  dailySalaryCents: number;
  timezone?: string;
  sessions?: Array<{
    id?: string;
    startedAt: Date | string;
    status?: string | null;
    overtimeMinutes?: number | null;
    requiresApproval?: boolean | null;
    approvedAt?: Date | string | null;
    approvedBy?: string | null;
    rejectionReason?: string | null;
    branchId?: string | null;
  }>;
  approvals?: Array<{
    id?: string;
    shiftSessionId?: string | null;
    status: string;
    approvalType?: string;
    overtimeMinutes?: number | null;
    rejectionReason?: string | null;
  }>;
  dbInstance?: any;
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

export type VacationBalanceStatus = "AVAILABLE" | "MISSING" | "QUERY_ERROR";

export interface VacationPeriodBreakdown {
  vacationDaysTaken: number;
  vacationDaysEligible: number;
  vacationDaysExceeded: number;
  vacationBasePayCents: number;
  vacationPrimeCents: number;
  vacationBonusPercent: number;
  vacationAvailableBalance: number;
  vacationRemainingBalance: number;
  hasVacations: boolean;
  /**
   * Distingue saldo conocido (AVAILABLE), dato ausente (MISSING) y consulta
   * fallida (QUERY_ERROR). Un fallo de consulta NO se colapsa a saldo 0: son
   * estados distintos y NOM-06 bloquea aprobación sobre MISSING/QUERY_ERROR.
   */
  vacationBalanceStatus: VacationBalanceStatus;
  /** Estado de la consulta de solicitudes (un fallo no se lee como "sin vacaciones"). */
  vacationRequestsStatus: "AVAILABLE" | "QUERY_ERROR";
  justification:
    | "LFT_ARTS_76_80"
    | "SIN_VACACIONES"
    | "EXCEEDED_VACATION_BALANCE"
    | "VACATION_BALANCE_MISSING"
    | "VACATION_BALANCE_QUERY_ERROR"
    | "VACATION_REQUESTS_QUERY_ERROR";
  approvedRequestsCount: number;
  rejectedRequestsCount: number;
  pendingRequestsCount: number;
  details?: Array<{
    requestId?: string;
    startDate: string;
    endDate: string;
    days: number;
    status: string;
  }>;
}

export interface LeavePeriodBreakdown {
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  hasPaidLeave: boolean;
  hasUnpaidLeave: boolean;
  /** Estado de la consulta de permisos: un fallo no se lee como "sin permisos". */
  leavesStatus: "AVAILABLE" | "QUERY_ERROR";
  details: Array<{
    leaveRequestId?: string;
    leaveTypeName: string;
    startDate: string;
    endDate: string;
    days: number;
    isPaid: boolean;
    status: string;
  }>;
}

export interface ResolveVacationsInput {
  userId: string;
  companyId: string;
  startDate: string;
  endDate: string;
  dailySalaryCents: number;
  vacationBonusPercent?: number; // default 25 (minimum 25 per LFT Art. 80)
  timezone?: string;
  vacationRequests?: Array<{
    id?: string;
    startDate: Date | string;
    endDate: Date | string;
    totalDays?: number | null;
    status?: string | null;
    rejectionReason?: string | null;
  }>;
  leaveRequests?: Array<{
    id?: string;
    leaveTypeId?: string;
    leaveTypeName?: string;
    startDate: Date | string;
    endDate: Date | string;
    totalDays?: number | null;
    status?: string | null;
    isPaid?: boolean | null;
    rejectionReason?: string | null;
  }>;
  vacationAccruals?: Array<{
    year: number;
    daysBalance: number;
    daysTaken?: number | null;
    daysAccrued?: number | null;
  }>;
  leaveBalances?: Array<{
    leaveTypeId?: string;
    year?: number;
    balance: number;
  }>;
  dbInstance?: any;
}

export interface ResolveLeavesInput {
  userId: string;
  companyId: string;
  startDate: string;
  endDate: string;
  timezone?: string;
  leaveRequests?: Array<{
    id?: string;
    leaveTypeId?: string;
    leaveTypeName?: string;
    startDate: Date | string;
    endDate: Date | string;
    totalDays?: number | null;
    status?: string | null;
    isPaid?: boolean | null;
    rejectionReason?: string | null;
  }>;
  dbInstance?: any;
}

export interface AttendancePeriodResolution {
  calendarDays: number;
  effectiveDaysInPeriod: number;
  approvedAttendanceDays: number;
  holidayDaysWorked: number;
  holidayDaysRested: number;
  vacationDays: number;
  paidLeaveDays: number;
  otherPaidLeaveDays?: number;
  unpaidAbsenceDays: number;
  payableDays: number;
  hasPendingAttendance: boolean;
  pendingAttendanceDetails: Array<{
    sessionId: string;
    date: string;
    reason: string;
    status?: string | null;
  }>;
  operationalZone: {
    timezone: string;
    geographicZone: MinimumWageZone;
    minimumWageDailyCents: number;
  };
}

export interface ResolveAttendanceInput {
  userId: string;
  companyId: string;
  startDate: string;
  endDate: string;
  effectiveDaysInPeriod?: number;
  branchId?: string | null;
  geographicZone?: MinimumWageZone;
  timezone?: string;
  sessions?: Array<{
    id?: string;
    startedAt: Date | string;
    status?: string | null;
    overtimeMinutes?: number | null;
    requiresApproval?: boolean | null;
    approvedAt?: Date | string | null;
    approvedBy?: string | null;
    rejectionReason?: string | null;
    branchId?: string | null;
  }>;
  approvals?: Array<{
    id?: string;
    shiftSessionId?: string | null;
    status: string;
    approvalType?: string;
    overtimeMinutes?: number | null;
    rejectionReason?: string | null;
  }>;
  holidays?: Array<{
    date: Date | string;
    isMandatory?: boolean | null;
  }>;
  vacations?: Array<{
    startDate: Date | string;
    endDate: Date | string;
    totalDays?: number | null;
    status?: string | null;
  }>;
  leaves?: Array<{
    startDate: Date | string;
    endDate: Date | string;
    totalDays?: number | null;
    isPaid?: boolean | null;
    status?: string | null;
  }>;
  dbInstance?: any;
}

/**
 * Resuelve la asistencia, faltas, festivos y licencias para un empleado y período determinado.
 * Convierte los instantes de checada a fecha civil local según la zona horaria de la sucursal.
 * Detecta y detalla cualquier sesión pendiente de aprobación o activa (rechazo estricto).
 * Calcula días pagaderos y deduce ausencias no justificadas / no pagadas del salario base.
 */
export async function resolveAttendanceForPeriod(
  input: ResolveAttendanceInput
): Promise<AttendancePeriodResolution> {
  const {
    userId,
    companyId,
    startDate,
    endDate,
    effectiveDaysInPeriod: inputEffectiveDays,
    branchId,
    geographicZone: inputZone,
    timezone: inputTimezone,
    sessions: preloadedSessions,
    holidays: preloadedHolidays,
    vacations: preloadedVacations,
    leaves: preloadedLeaves,
    dbInstance = db,
  } = input;

  const { calendarDays } = validatePayrollPeriod(startDate, endDate);
  const effectiveDaysInPeriod = inputEffectiveDays ?? calendarDays;

  const isPreloaded =
    preloadedSessions !== undefined ||
    preloadedHolidays !== undefined ||
    preloadedVacations !== undefined ||
    preloadedLeaves !== undefined;

  // 1. Zona horaria operativa
  let timezone = inputTimezone;
  if (!timezone && branchId && !isPreloaded) {
    try {
      const [br] = await dbInstance
        .select({ timezone: branches.timezone })
        .from(branches)
        .where(eq(branches.id, branchId))
        .limit(1);
      if (br?.timezone) timezone = br.timezone;
    } catch {
      // Fallback a default si la consulta falla
    }
  }
  if (!timezone) {
    timezone = "America/Mexico_City";
  }

  // 2. Zona geográfica CONASAMI y salario mínimo aplicable
  const geographicZone: MinimumWageZone = inputZone ?? "GENERAL";
  let minimumWageDailyCents = 31504; // 2026 default GENERAL
  try {
    const wageRes = resolveSeveranceMinimumWage(endDate, geographicZone);
    minimumWageDailyCents = wageRes.dailyCents;
  } catch {
    minimumWageDailyCents = geographicZone === "ZLFN" ? 44087 : 31504;
  }

  const localCivilDate = (d: Date | string): string => {
    try {
      return diaCivilEnZona(typeof d === "string" ? new Date(d) : d, timezone);
    } catch {
      return typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
    }
  };

  // 3. Obtener y clasificar sesiones de turno y solicitudes de horas extra
  let rawSessions: NonNullable<ResolveAttendanceInput["sessions"]> = [];

  if (preloadedSessions) {
    rawSessions = preloadedSessions;
  } else if (!isPreloaded) {
    const bufferStart = new Date(`${startDate}T00:00:00Z`);
    bufferStart.setUTCDate(bufferStart.getUTCDate() - 2);
    const bufferEnd = new Date(`${endDate}T23:59:59Z`);
    bufferEnd.setUTCDate(bufferEnd.getUTCDate() + 2);

    try {
      rawSessions = await dbInstance
        .select({
          id: shiftSessions.id,
          startedAt: shiftSessions.startedAt,
          status: shiftSessions.status,
          overtimeMinutes: shiftSessions.overtimeMinutes,
          requiresApproval: shiftSessions.requiresApproval,
          approvedAt: shiftSessions.approvedAt,
          approvedBy: shiftSessions.approvedBy,
          rejectionReason: shiftSessions.rejectionReason,
          branchId: shiftSessions.branchId,
        })
        .from(shiftSessions)
        .where(
          and(
            eq(shiftSessions.userId, userId),
            gte(shiftSessions.startedAt, bufferStart),
            lte(shiftSessions.startedAt, bufferEnd)
          )
        );
    } catch {
      rawSessions = [];
    }
  }

  // Cargar aprobaciones vinculadas si existen
  let rawApprovals: Array<{
    id?: string;
    shiftSessionId: string | null;
    status: string;
    approvalType?: string;
    overtimeMinutes?: number | null;
    rejectionReason?: string | null;
  }> = [];

  if (input.approvals) {
    rawApprovals = input.approvals.map((a) => ({
      ...a,
      shiftSessionId: a.shiftSessionId ?? null,
    }));
  } else if (!isPreloaded) {
    try {
      rawApprovals = await dbInstance
        .select({
          id: shiftApprovals.id,
          shiftSessionId: shiftApprovals.shiftSessionId,
          status: shiftApprovals.status,
          approvalType: shiftApprovals.approvalType,
          overtimeMinutes: shiftApprovals.overtimeMinutes,
          rejectionReason: shiftApprovals.rejectionReason,
        })
        .from(shiftApprovals)
        .where(
          and(
            eq(shiftApprovals.companyId, companyId),
            eq(shiftApprovals.requestedFor, userId),
            eq(shiftApprovals.approvalType, "OVERTIME")
          )
        );
    } catch {
      rawApprovals = [];
    }
  }

  const approvalStatusBySession = new Map<string, string>();
  for (const a of rawApprovals) {
    if (a.shiftSessionId) {
      approvalStatusBySession.set(a.shiftSessionId, a.status.toUpperCase());
    }
  }

  const pendingAttendanceDetails: AttendancePeriodResolution["pendingAttendanceDetails"] = [];
  const approvedDates = new Set<string>();
  const noShowDates = new Set<string>();

  for (const s of rawSessions) {
    if (!s.startedAt) continue;
    const sessionDate = localCivilDate(s.startedAt);
    if (sessionDate < startDate || sessionDate > endDate) continue;

    const status = (s.status || "PENDING").toUpperCase();
    const linkedStatus = s.id ? approvalStatusBySession.get(s.id) : undefined;
    const isExplicitlyRejected =
      status === "REJECTED" ||
      status === "CANCELLED" ||
      linkedStatus === "REJECTED" ||
      linkedStatus === "CANCELLED";
    const isExplicitlyApproved =
      s.approvedAt != null || linkedStatus === "APPROVED";

    // Detección estricta de asistencia pendiente o en curso
    if (status === "PENDING") {
      pendingAttendanceDetails.push({
        sessionId: s.id || "unspecified",
        date: sessionDate,
        reason: "Sesión de turno en estado PENDING",
        status: s.status,
      });
    } else if (status === "ACTIVE") {
      pendingAttendanceDetails.push({
        sessionId: s.id || "unspecified",
        date: sessionDate,
        reason: "Sesión activa en curso (sin check-out registrado)",
        status: s.status,
      });
    } else if (s.requiresApproval && !isExplicitlyApproved && !isExplicitlyRejected) {
      pendingAttendanceDetails.push({
        sessionId: s.id || "unspecified",
        date: sessionDate,
        reason: "Sesión de turno requiere aprobación de manager y aún no ha sido aprobada",
        status: s.status,
      });
    }

    // Clasificación de asistencia aprobada y faltas
    if (status === "COMPLETED" && (!s.requiresApproval || isExplicitlyApproved)) {
      approvedDates.add(sessionDate);
    } else if (status === "NO_SHOW") {
      noShowDates.add(sessionDate);
    }
  }

  const hasPendingAttendance = pendingAttendanceDetails.length > 0;

  // 4. Obtener y evaluar días festivos oficiales obligatorios (LFT Arts. 74 & 75)
  let rawHolidays: Array<{ date: Date | string; isMandatory?: boolean | null }> = [];
  if (preloadedHolidays) {
    rawHolidays = preloadedHolidays;
  } else if (!isPreloaded) {
    try {
      rawHolidays = await dbInstance
        .select({
          date: holidays.date,
          isMandatory: holidays.isMandatory,
        })
        .from(holidays)
        .where(
          and(
            eq(holidays.companyId, companyId),
            gte(holidays.date, startDate),
            lte(holidays.date, endDate)
          )
        );
    } catch {
      rawHolidays = [];
    }
  }

  const holidayWorkedDates = new Set<string>();
  const holidayRestedDates = new Set<string>();

  for (const h of rawHolidays) {
    if (h.isMandatory === false) continue;
    const hDate = typeof h.date === "string" ? h.date.slice(0, 10) : localCivilDate(h.date);
    if (hDate < startDate || hDate > endDate) continue;

    if (approvedDates.has(hDate)) {
      holidayWorkedDates.add(hDate);
    } else if (!noShowDates.has(hDate)) {
      holidayRestedDates.add(hDate);
    }
  }

  // 5. Evaluar vacaciones y permisos aprobados
  let rawVacations: Array<{ startDate: Date | string; endDate: Date | string; status?: string | null }> = [];
  if (preloadedVacations) {
    rawVacations = preloadedVacations;
  } else if (!isPreloaded) {
    try {
      rawVacations = await dbInstance
        .select({
          startDate: vacationRequests.startDate,
          endDate: vacationRequests.endDate,
          status: vacationRequests.status,
        })
        .from(vacationRequests)
        .where(
          and(
            eq(vacationRequests.userId, userId),
            eq(vacationRequests.status, "APPROVED")
          )
        );
    } catch {
      rawVacations = [];
    }
  }

  const vacationDates = new Set<string>();
  for (const v of rawVacations) {
    if (v.status !== "APPROVED") continue;
    const vStart = typeof v.startDate === "string" ? v.startDate.slice(0, 10) : localCivilDate(v.startDate);
    const vEnd = typeof v.endDate === "string" ? v.endDate.slice(0, 10) : localCivilDate(v.endDate);

    const cur = parseISO(vStart > startDate ? vStart : startDate);
    const limit = parseISO(vEnd < endDate ? vEnd : endDate);
    if (cur <= limit) {
      let d = cur;
      while (d <= limit) {
        vacationDates.add(format(d, "yyyy-MM-dd"));
        d = addDays(d, 1);
      }
    }
  }

  let rawLeaves: Array<{ startDate: Date | string; endDate: Date | string; isPaid?: boolean | null; status?: string | null }> = [];
  if (preloadedLeaves) {
    rawLeaves = preloadedLeaves;
  } else if (!isPreloaded) {
    try {
      rawLeaves = await dbInstance
        .select({
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          status: leaveRequests.status,
          isPaid: leaveTypes.isPaid,
        })
        .from(leaveRequests)
        .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
        .where(
          and(
            eq(leaveRequests.userId, userId),
            eq(leaveRequests.status, "APPROVED")
          )
        );
    } catch {
      rawLeaves = [];
    }
  }

  const otherPaidLeaveDates = new Set<string>();
  const unpaidLeaveDates = new Set<string>();
  for (const l of rawLeaves) {
    if (l.status !== "APPROVED") continue;
    const lStart = typeof l.startDate === "string" ? l.startDate.slice(0, 10) : localCivilDate(l.startDate);
    const lEnd = typeof l.endDate === "string" ? l.endDate.slice(0, 10) : localCivilDate(l.endDate);

    const cur = parseISO(lStart > startDate ? lStart : startDate);
    const limit = parseISO(lEnd < endDate ? lEnd : endDate);
    if (cur <= limit) {
      let d = cur;
      while (d <= limit) {
        const formatted = format(d, "yyyy-MM-dd");
        if (l.isPaid === false) {
          unpaidLeaveDates.add(formatted);
        } else {
          otherPaidLeaveDates.add(formatted);
        }
        d = addDays(d, 1);
      }
    }
  }

  // Días con goce consolidados (vacaciones + permisos con goce)
  const paidLeaveDates = new Set([...vacationDates, ...otherPaidLeaveDates]);

  // 6. Cálculo de faltas y días pagaderos
  const unpaidAbsenceDates = new Set([...noShowDates, ...unpaidLeaveDates]);
  const unpaidAbsenceDays = unpaidAbsenceDates.size;
  const payableDays = Math.max(0, effectiveDaysInPeriod - unpaidAbsenceDays);

  return {
    calendarDays,
    effectiveDaysInPeriod,
    approvedAttendanceDays: approvedDates.size,
    holidayDaysWorked: holidayWorkedDates.size,
    holidayDaysRested: holidayRestedDates.size,
    vacationDays: vacationDates.size,
    paidLeaveDays: paidLeaveDates.size,
    otherPaidLeaveDays: otherPaidLeaveDates.size,
    unpaidAbsenceDays,
    payableDays,
    hasPendingAttendance,
    pendingAttendanceDetails,
    operationalZone: {
      timezone,
      geographicZone,
      minimumWageDailyCents,
    },
  };
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
    code: 'GHOST_EMPLOYEE' | 'MISSING_RFC' | 'MISSING_CURP' | 'NO_CONTRACT' | 'UNSUPPORTED_CURRENCY' | 'INVALID_SALARY' | 'INACTIVE_CONTRACT_PERIOD' | 'PERIOD_ALREADY_COMPLETED' | 'INVALID_PERIOD' | 'PENDING_ATTENDANCE' | string;
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
  branchId?: string,
  options?: {
    dbInstance?: any;
    geographicZone?: MinimumWageZone;
  }
): Promise<PayrollPreStampingValidation> {
  const dbInstance = options?.dbInstance ?? db;
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
  const isFrozen = await isPayrollPeriodFrozen(companyId, startDate, endDate, dbInstance);
  if (isFrozen) {
    validationErrors.push({
      userId: "PERIOD_CHECK",
      employeeName: "Período de Nómina",
      error: `El período de nómina ${startDate} - ${endDate} ya fue completado y se encuentra congelado.`,
      code: "PERIOD_ALREADY_COMPLETED",
      severity: "BLOCKING",
    });
  }

  const activeStaff = await dbInstance
    .select({
      userId: users.id,
      name: users.name,
      branchId: users.branchId,
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
    let contractRes: ContractSalaryResolution | null = null;
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
        contractRes = resolveContractSalaryForPeriod({
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

    // Check Attendance, Absences, Holidays and Operational Zone
    const attendance = await resolveAttendanceForPeriod({
      userId: emp.userId,
      companyId,
      startDate,
      endDate,
      branchId: branchId ?? emp.branchId,
      geographicZone: options?.geographicZone,
      dbInstance,
    });

    // Validar salario contra salario mínimo de la zona geográfica
    if (emp.baseSalary && emp.baseSalary > 0 && emp.baseSalary < attendance.operationalZone.minimumWageDailyCents) {
      validationErrors.push({
        userId: emp.userId,
        employeeName: emp.name || "Sin Nombre",
        error: `El salario base registrado (${emp.baseSalary}¢) es inferior al salario mínimo CONASAMI para la zona ${attendance.operationalZone.geographicZone} (${attendance.operationalZone.minimumWageDailyCents}¢).`,
        code: "INVALID_SALARY",
        severity: "BLOCKING",
      });
      hasBlockingError = true;
    }

    // Rechazo estricto de asistencia pendiente
    if (attendance.hasPendingAttendance) {
      validationErrors.push({
        userId: emp.userId,
        employeeName: emp.name || "Sin Nombre",
        error: `Asistencia pendiente: el empleado tiene ${attendance.pendingAttendanceDetails.length} sesión(es) en estado PENDING, ACTIVE o pendiente de aprobación por el manager.`,
        code: "PENDING_ATTENDANCE",
        severity: "BLOCKING",
      });
      hasBlockingError = true;
    }

    // Detección de Empleados Fantasma (sin asistencia aprobada, sin permisos/vacaciones aprobados y sin sesiones pendientes)
    if (
      attendance.approvedAttendanceDays === 0 &&
      attendance.paidLeaveDays === 0 &&
      !attendance.hasPendingAttendance
    ) {
      validationErrors.push({
        userId: emp.userId,
        employeeName: emp.name || "Sin Nombre",
        error: `Alerta antifraude: Empleado sin checadas registradas en el período ni vacaciones/incidencias aprobadas (Posible empleado fantasma).`,
        code: "GHOST_EMPLOYEE",
        severity: "BLOCKING",
      });
      hasBlockingError = true;
    }

    if (contractRes) {
      const unpaidDeduction = attendance.unpaidAbsenceDays * contractRes.dailySalaryCents;
      const employeeGross = Math.max(0, contractRes.baseSalaryCents - unpaidDeduction);
      totalGrossSalaryCents += employeeGross;
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

export function calculateOvertimeBreakdown(options: {
  dailySalaryCents: number;
  startDate: string;
  endDate: string;
  sessions?: Array<{
    id?: string;
    startedAt: Date | string;
    status?: string | null;
    overtimeMinutes?: number | null;
    requiresApproval?: boolean | null;
    approvedAt?: Date | string | null;
    approvedBy?: string | null;
    rejectionReason?: string | null;
    branchId?: string | null;
  }>;
  approvals?: Array<{
    id?: string;
    shiftSessionId?: string | null;
    status: string;
    approvalType?: string;
    overtimeMinutes?: number | null;
    rejectionReason?: string | null;
  }>;
  timezone?: string;
}): OvertimeBreakdown {
  const {
    dailySalaryCents,
    startDate,
    endDate,
    sessions = [],
    approvals = [],
    timezone = "America/Mexico_City",
  } = options;

  // 1. Mapear aprobaciones por shiftSessionId
  const approvalsBySession = new Map<
    string,
    Array<{
      id?: string;
      shiftSessionId?: string | null;
      status: string;
      approvalType?: string;
      overtimeMinutes?: number | null;
      rejectionReason?: string | null;
    }>
  >();

  if (approvals) {
    for (const app of approvals) {
      if (!app.shiftSessionId) continue;
      const list = approvalsBySession.get(app.shiftSessionId) ?? [];
      list.push(app);
      approvalsBySession.set(app.shiftSessionId, list);
    }
  }

  // 2. Deduplicar sesiones por id
  const uniqueSessions = new Map<string, NonNullable<typeof sessions>[0]>();
  sessions.forEach((s, idx) => {
    const key = s.id || `session-synthetic-${idx}`;
    if (!uniqueSessions.has(key)) {
      uniqueSessions.set(key, s);
    }
  });

  let approvedSessionsCount = 0;
  let rejectedCount = 0;
  const weeklyMinutesMap = new Map<string, number>();

  // 3. Procesar cada sesión única
  for (const s of uniqueSessions.values()) {
    if (!s.startedAt) continue;

    const dateStr = (() => {
      try {
        return diaCivilEnZona(
          typeof s.startedAt === "string" ? new Date(s.startedAt) : s.startedAt,
          timezone
        );
      } catch {
        return typeof s.startedAt === "string"
          ? s.startedAt.slice(0, 10)
          : new Date(s.startedAt).toISOString().slice(0, 10);
      }
    })();

    if (dateStr < startDate || dateStr > endDate) continue;

    const sessionApprovals = s.id ? approvalsBySession.get(s.id) : undefined;
    let isApproved = false;
    let isRejected = false;
    let effectiveOvertimeMinutes = 0;

    if (sessionApprovals && sessionApprovals.length > 0) {
      const rejectedApp = sessionApprovals.find(
        (a) => a.status.toUpperCase() === "REJECTED" || a.status.toUpperCase() === "CANCELLED"
      );
      const approvedApp = sessionApprovals.find(
        (a) => a.status.toUpperCase() === "APPROVED" && (a.approvalType === "OVERTIME" || !a.approvalType)
      );

      if (rejectedApp) {
        isRejected = true;
      } else if (approvedApp) {
        isApproved = true;
        effectiveOvertimeMinutes = approvedApp.overtimeMinutes ?? s.overtimeMinutes ?? 0;
      }
    } else {
      const sessionStatus = (s.status || "COMPLETED").toUpperCase();
      if (
        sessionStatus === "REJECTED" ||
        sessionStatus === "CANCELLED" ||
        (s.rejectionReason && !s.approvedAt)
      ) {
        isRejected = true;
      } else if (sessionStatus === "COMPLETED") {
        if (!s.requiresApproval || s.approvedAt != null) {
          isApproved = true;
          effectiveOvertimeMinutes = s.overtimeMinutes ?? 0;
        }
      }
    }

    if (isRejected) {
      if ((s.overtimeMinutes ?? 0) > 0 || sessionApprovals?.some((a) => (a.overtimeMinutes ?? 0) > 0)) {
        rejectedCount++;
      }
      continue;
    }

    if (isApproved) {
      approvedSessionsCount++;
      if (effectiveOvertimeMinutes > 0) {
        const d = parseISO(dateStr);
        const weekStart = startOfWeek(d, { weekStartsOn: 1 });
        const weekEnd = addDays(weekStart, 6);
        const weekKey = `${format(weekStart, "yyyy-MM-dd")}/${format(weekEnd, "yyyy-MM-dd")}`;

        weeklyMinutesMap.set(
          weekKey,
          (weeklyMinutesMap.get(weekKey) ?? 0) + effectiveOvertimeMinutes
        );
      }
    }
  }

  // 4. Calcular desglose semanal según LFT Arts. 66, 67 y 68
  const sortedWeekKeys = Array.from(weeklyMinutesMap.keys()).sort();
  const weeklyBreakdown: OvertimeWeeklyBreakdown[] = [];

  for (const weekKey of sortedWeekKeys) {
    const totalWeeklyMinutes = weeklyMinutesMap.get(weekKey) ?? 0;
    if (totalWeeklyMinutes <= 0) continue;

    const doubleMinutes = Math.min(totalWeeklyMinutes, 540); // Primeras 9h (540 min)
    const tripleMinutes = Math.max(0, totalWeeklyMinutes - 540); // Excedente al triple

    const doublePayCents =
      dailySalaryCents > 0
        ? Math.round((doubleMinutes * dailySalaryCents * 2) / 480)
        : 0;
    const triplePayCents =
      dailySalaryCents > 0
        ? Math.round((tripleMinutes * dailySalaryCents * 3) / 480)
        : 0;

    weeklyBreakdown.push({
      calendarWeek: weekKey,
      doubleMinutes,
      tripleMinutes,
      doublePayCents,
      triplePayCents,
    });
  }

  const totalDoubleMinutes = weeklyBreakdown.reduce((sum, w) => sum + w.doubleMinutes, 0);
  const totalTripleMinutes = weeklyBreakdown.reduce((sum, w) => sum + w.tripleMinutes, 0);
  const totalDoublePayCents = weeklyBreakdown.reduce((sum, w) => sum + w.doublePayCents, 0);
  const totalTriplePayCents = weeklyBreakdown.reduce((sum, w) => sum + w.triplePayCents, 0);
  const totalMinutes = totalDoubleMinutes + totalTripleMinutes;
  const totalPayCents = totalDoublePayCents + totalTriplePayCents;
  const hasOvertime = totalMinutes > 0;

  return {
    totalMinutes,
    doubleMinutes: totalDoubleMinutes,
    tripleMinutes: totalTripleMinutes,
    doublePayCents: totalDoublePayCents,
    triplePayCents: totalTriplePayCents,
    totalPayCents,
    hasOvertime,
    justification: hasOvertime ? "LFT_ARTS_66_67_68" : "SIN_HORAS_EXTRA",
    weeklyBreakdown,
    approvedSessionsCount,
    rejectedCount,
  };
}

export function resolveOvertimeForPeriod(
  input: ResolveOvertimeInput & { sessions: any[] }
): OvertimeBreakdown;
export function resolveOvertimeForPeriod(
  input: ResolveOvertimeInput
): Promise<OvertimeBreakdown> | OvertimeBreakdown;
export function resolveOvertimeForPeriod(
  input: ResolveOvertimeInput
): Promise<OvertimeBreakdown> | OvertimeBreakdown {
  validatePayrollPeriod(input.startDate, input.endDate);

  if (input.sessions !== undefined) {
    return calculateOvertimeBreakdown({
      dailySalaryCents: input.dailySalaryCents,
      startDate: input.startDate,
      endDate: input.endDate,
      sessions: input.sessions,
      approvals: input.approvals,
      timezone: input.timezone,
    });
  }

  return (async () => {
    const dbInstance = input.dbInstance ?? db;
    const bufferStart = new Date(`${input.startDate}T00:00:00Z`);
    bufferStart.setUTCDate(bufferStart.getUTCDate() - 2);
    const bufferEnd = new Date(`${input.endDate}T23:59:59Z`);
    bufferEnd.setUTCDate(bufferEnd.getUTCDate() + 2);

    let rawSessions: any[] = [];
    try {
      rawSessions = await dbInstance
        .select({
          id: shiftSessions.id,
          startedAt: shiftSessions.startedAt,
          status: shiftSessions.status,
          overtimeMinutes: shiftSessions.overtimeMinutes,
          requiresApproval: shiftSessions.requiresApproval,
          approvedAt: shiftSessions.approvedAt,
          approvedBy: shiftSessions.approvedBy,
          rejectionReason: shiftSessions.rejectionReason,
          branchId: shiftSessions.branchId,
        })
        .from(shiftSessions)
        .where(
          and(
            eq(shiftSessions.userId, input.userId),
            gte(shiftSessions.startedAt, bufferStart),
            lte(shiftSessions.startedAt, bufferEnd)
          )
        );
    } catch {
      rawSessions = [];
    }

    let rawApprovals: any[] = [];
    try {
      rawApprovals = await dbInstance
        .select({
          id: shiftApprovals.id,
          shiftSessionId: shiftApprovals.shiftSessionId,
          status: shiftApprovals.status,
          approvalType: shiftApprovals.approvalType,
          overtimeMinutes: shiftApprovals.overtimeMinutes,
          rejectionReason: shiftApprovals.rejectionReason,
        })
        .from(shiftApprovals)
        .where(
          and(
            eq(shiftApprovals.companyId, input.companyId),
            eq(shiftApprovals.requestedFor, input.userId),
            eq(shiftApprovals.approvalType, "OVERTIME")
          )
        );
    } catch {
      rawApprovals = [];
    }

    return calculateOvertimeBreakdown({
      dailySalaryCents: input.dailySalaryCents,
      startDate: input.startDate,
      endDate: input.endDate,
      sessions: rawSessions,
      approvals: rawApprovals,
      timezone: input.timezone,
    });
  })();
}

/**
 * Resuelve las vacaciones de un empleado para un período de nómina determinado (LFT Arts. 76, 79, 80 & 81).
 * Valida solicitudes aprobadas (status = 'APPROVED') dentro del rango del período.
 * Compara contra el saldo acumulado en vacationAccruals / leaveBalances para determinar
 * días elegibles vs días excedidos.
 * Calcula la prima vacacional mínima del 25% (LFT Art. 80) en centavos sobre los días elegibles.
 */
export async function resolveVacationsForPeriod(
  input: ResolveVacationsInput
): Promise<VacationPeriodBreakdown> {
  const { startDate, endDate } = validatePayrollPeriod(input.startDate, input.endDate);
  const {
    userId,
    companyId,
    dailySalaryCents,
    vacationBonusPercent = 25,
    timezone = "America/Mexico_City",
    vacationRequests: preloadedVacations,
    vacationAccruals: preloadedAccruals,
    leaveBalances: preloadedLeaveBalances,
    dbInstance = db,
  } = input;

  const bonusPercent = Math.max(25, vacationBonusPercent ?? 25);

  const localCivilDate = (d: Date | string): string => {
    try {
      return diaCivilEnZona(typeof d === "string" ? new Date(d) : d, timezone);
    } catch {
      return typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
    }
  };

  // 1. Obtener solicitudes de vacaciones
  let vacationRequestsStatus: "AVAILABLE" | "QUERY_ERROR" = "AVAILABLE";
  let rawRequests: Array<{
    id?: string;
    startDate: Date | string;
    endDate: Date | string;
    totalDays?: number | null;
    status?: string | null;
    rejectionReason?: string | null;
  }> = [];

  if (preloadedVacations !== undefined) {
    rawRequests = preloadedVacations;
  } else if (dbInstance) {
    try {
      rawRequests = await dbInstance
        .select({
          id: vacationRequests.id,
          startDate: vacationRequests.startDate,
          endDate: vacationRequests.endDate,
          totalDays: vacationRequests.totalDays,
          status: vacationRequests.status,
          rejectionReason: vacationRequests.rejectionReason,
        })
        .from(vacationRequests)
        .where(
          and(
            eq(vacationRequests.userId, userId),
            eq(vacationRequests.companyId, companyId)
          )
        );
    } catch {
      // Un fallo de consulta NO equivale a "sin vacaciones": se marca aparte
      // para que no se lea como 0 prima confirmado.
      vacationRequestsStatus = "QUERY_ERROR";
      rawRequests = [];
    }
  }

  // 2. Conteo de solicitudes y filtrado por estado
  let approvedRequestsCount = 0;
  let rejectedRequestsCount = 0;
  let pendingRequestsCount = 0;

  for (const req of rawRequests) {
    const status = (req.status || "PENDING").toUpperCase();
    if (status === "APPROVED") {
      approvedRequestsCount++;
    } else if (status === "REJECTED" || status === "CANCELLED" || req.rejectionReason) {
      rejectedRequestsCount++;
    } else {
      pendingRequestsCount++;
    }
  }

  // 3. Fechas de vacaciones aprobadas en el período (deduplicadas por Set)
  const vacationApprovedDates = new Set<string>();
  const details: NonNullable<VacationPeriodBreakdown["details"]> = [];

  for (const req of rawRequests) {
    const status = (req.status || "").toUpperCase();
    if (status !== "APPROVED") continue;

    const vStart = typeof req.startDate === "string" ? req.startDate.slice(0, 10) : localCivilDate(req.startDate);
    const vEnd = typeof req.endDate === "string" ? req.endDate.slice(0, 10) : localCivilDate(req.endDate);

    const cur = parseISO(vStart > startDate ? vStart : startDate);
    const limit = parseISO(vEnd < endDate ? vEnd : endDate);
    let daysInPeriod = 0;

    if (cur <= limit) {
      let d = cur;
      while (d <= limit) {
        vacationApprovedDates.add(format(d, "yyyy-MM-dd"));
        daysInPeriod++;
        d = addDays(d, 1);
      }
    }

    if (daysInPeriod > 0) {
      details.push({
        requestId: req.id,
        startDate: vStart,
        endDate: vEnd,
        days: daysInPeriod,
        status: "APPROVED",
      });
    }
  }

  const vacationDaysTaken = vacationApprovedDates.size;
  const hasVacations = vacationDaysTaken > 0;

  // 4. Resolver saldo disponible (vacationAccruals / leaveBalances)
  //    Distinguir dato conocido / ausente / consulta fallida: un fallo no se
  //    colapsa a 0 (que se leería como "sin saldo" y produciría prima 0).
  let vacationAvailableBalance = 0;
  let vacationBalanceStatus: VacationBalanceStatus = "MISSING";

  if (preloadedAccruals !== undefined) {
    vacationAvailableBalance = preloadedAccruals.reduce(
      (acc, a) => acc + Math.max(0, a.daysBalance ?? 0),
      0
    );
    vacationBalanceStatus = "AVAILABLE";
  } else if (preloadedLeaveBalances !== undefined) {
    vacationAvailableBalance = preloadedLeaveBalances.reduce(
      (acc, b) => acc + Math.max(0, b.balance ?? 0),
      0
    );
    vacationBalanceStatus = "AVAILABLE";
  } else if (dbInstance) {
    try {
      const accrualRows = await dbInstance
        .select({
          daysBalance: vacationAccruals.daysBalance,
        })
        .from(vacationAccruals)
        .where(
          and(
            eq(vacationAccruals.userId, userId),
            eq(vacationAccruals.companyId, companyId)
          )
        );

      if (accrualRows.length > 0) {
        vacationAvailableBalance = accrualRows.reduce(
          (acc: number, a: { daysBalance: number | null }) => acc + Math.max(0, a.daysBalance ?? 0),
          0
        );
        vacationBalanceStatus = "AVAILABLE";
      } else {
        // Fallback secundario a leaveBalances para tipo VACATION
        try {
          const balanceRows = await dbInstance
            .select({
              balance: leaveBalances.balance,
            })
            .from(leaveBalances)
            .innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
            .where(
              and(
                eq(leaveBalances.userId, userId),
                eq(leaveTypes.name, "VACATION")
              )
            );

          if (balanceRows.length > 0) {
            vacationAvailableBalance = balanceRows.reduce(
              (acc: number, b: { balance: number | null }) => acc + Math.max(0, b.balance ?? 0),
              0
            );
            vacationBalanceStatus = "AVAILABLE";
          }
        } catch {
          vacationBalanceStatus = "QUERY_ERROR";
        }
      }
    } catch {
      vacationBalanceStatus = "QUERY_ERROR";
    }
  }

  // 5. Cálculo de días elegibles vs excedidos y prima vacacional
  let vacationDaysEligible = 0;
  let vacationDaysExceeded = 0;
  let justification: VacationPeriodBreakdown["justification"];

  if (vacationRequestsStatus === "QUERY_ERROR") {
    // No se pudieron leer las solicitudes: no se afirma "sin vacaciones".
    vacationDaysEligible = 0;
    vacationDaysExceeded = 0;
    justification = "VACATION_REQUESTS_QUERY_ERROR";
  } else if (!hasVacations) {
    vacationDaysEligible = 0;
    vacationDaysExceeded = 0;
    justification = "SIN_VACACIONES";
  } else if (vacationBalanceStatus === "QUERY_ERROR") {
    // Hay vacaciones pero el saldo no se pudo leer: no es 0 confirmado.
    vacationDaysEligible = 0;
    vacationDaysExceeded = vacationDaysTaken;
    justification = "VACATION_BALANCE_QUERY_ERROR";
  } else if (vacationBalanceStatus === "MISSING") {
    // Hay vacaciones aprobadas y no hay registro de saldo: dato ausente,
    // no "excedido" silencioso.
    vacationDaysEligible = 0;
    vacationDaysExceeded = vacationDaysTaken;
    justification = "VACATION_BALANCE_MISSING";
  } else {
    vacationDaysEligible = Math.min(vacationDaysTaken, Math.max(0, vacationAvailableBalance));
    vacationDaysExceeded = vacationDaysTaken - vacationDaysEligible;

    if (vacationDaysExceeded > 0 || vacationAvailableBalance === 0) {
      justification = "EXCEEDED_VACATION_BALANCE";
    } else {
      justification = "LFT_ARTS_76_80";
    }
  }

  const vacationBasePayCents = vacationDaysEligible * dailySalaryCents;
  const vacationPrimeCents = Math.round((vacationBasePayCents * bonusPercent) / 100);
  const vacationRemainingBalance = Math.max(0, vacationAvailableBalance - vacationDaysEligible);

  return {
    vacationDaysTaken,
    vacationDaysEligible,
    vacationDaysExceeded,
    vacationBasePayCents,
    vacationPrimeCents,
    vacationBonusPercent: bonusPercent,
    vacationAvailableBalance,
    vacationRemainingBalance,
    hasVacations,
    vacationBalanceStatus,
    vacationRequestsStatus,
    justification,
    approvedRequestsCount,
    rejectedRequestsCount,
    pendingRequestsCount,
    details,
  };
}

/**
 * Resuelve las licencias y permisos para un período de nómina determinado.
 * Clasifica permisos con goce (pagan 100% sueldo base, 0 prima vacacional)
 * vs permisos sin goce (deducen sueldo base como ausencias).
 */
export async function resolveLeavesForPeriod(
  input: ResolveLeavesInput
): Promise<LeavePeriodBreakdown> {
  const { startDate, endDate } = validatePayrollPeriod(input.startDate, input.endDate);
  const {
    userId,
    companyId,
    timezone = "America/Mexico_City",
    leaveRequests: preloadedLeaves,
    dbInstance = db,
  } = input;

  const localCivilDate = (d: Date | string): string => {
    try {
      return diaCivilEnZona(typeof d === "string" ? new Date(d) : d, timezone);
    } catch {
      return typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
    }
  };

  let leavesStatus: "AVAILABLE" | "QUERY_ERROR" = "AVAILABLE";
  let rawLeaves: Array<{
    id?: string;
    leaveTypeId?: string;
    leaveTypeName?: string;
    startDate: Date | string;
    endDate: Date | string;
    totalDays?: number | null;
    status?: string | null;
    isPaid?: boolean | null;
    rejectionReason?: string | null;
  }> = [];

  if (preloadedLeaves !== undefined) {
    rawLeaves = preloadedLeaves;
  } else if (dbInstance) {
    try {
      rawLeaves = await dbInstance
        .select({
          id: leaveRequests.id,
          leaveTypeId: leaveRequests.leaveTypeId,
          leaveTypeName: leaveTypes.name,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          totalDays: leaveRequests.totalDays,
          status: leaveRequests.status,
          isPaid: leaveTypes.isPaid,
          rejectionReason: leaveRequests.rejectionReason,
        })
        .from(leaveRequests)
        .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
        .where(
          and(
            eq(leaveRequests.userId, userId),
            eq(leaveRequests.companyId, companyId)
          )
        );
    } catch {
      // Un fallo de consulta no se lee como "sin permisos".
      leavesStatus = "QUERY_ERROR";
      rawLeaves = [];
    }
  }

  const paidLeaveDates = new Set<string>();
  const unpaidLeaveDates = new Set<string>();
  const details: LeavePeriodBreakdown["details"] = [];

  for (const l of rawLeaves) {
    const status = (l.status || "").toUpperCase();
    if (status !== "APPROVED") continue;

    const isPaid = l.isPaid !== false;
    const lStart = typeof l.startDate === "string" ? l.startDate.slice(0, 10) : localCivilDate(l.startDate);
    const lEnd = typeof l.endDate === "string" ? l.endDate.slice(0, 10) : localCivilDate(l.endDate);

    const cur = parseISO(lStart > startDate ? lStart : startDate);
    const limit = parseISO(lEnd < endDate ? lEnd : endDate);
    let daysInPeriod = 0;

    if (cur <= limit) {
      let d = cur;
      while (d <= limit) {
        const formatted = format(d, "yyyy-MM-dd");
        if (isPaid) {
          paidLeaveDates.add(formatted);
        } else {
          unpaidLeaveDates.add(formatted);
        }
        daysInPeriod++;
        d = addDays(d, 1);
      }
    }

    if (daysInPeriod > 0) {
      details.push({
        leaveRequestId: l.id,
        leaveTypeName: l.leaveTypeName || (isPaid ? "PAID_LEAVE" : "UNPAID_LEAVE"),
        startDate: lStart,
        endDate: lEnd,
        days: daysInPeriod,
        isPaid,
        status: "APPROVED",
      });
    }
  }

  return {
    paidLeaveDays: paidLeaveDates.size,
    unpaidLeaveDays: unpaidLeaveDates.size,
    hasPaidLeave: paidLeaveDates.size > 0,
    hasUnpaidLeave: unpaidLeaveDates.size > 0,
    leavesStatus,
    details,
  };
}

export async function calculateEmployeePayroll(
  userId: string,
  startDate: string,
  endDate: string,
  options?: {
    dbInstance?: any;
    branchId?: string;
    geographicZone?: MinimumWageZone;
    attendanceInput?: Partial<ResolveAttendanceInput>;
    vacationBonusPercent?: number;
    vacationBreakdown?: VacationPeriodBreakdown;
    vacationsInput?: Partial<ResolveVacationsInput>;
  }
) {
  const dbInstance = options?.dbInstance ?? db;

  // 0. Validar período y usuario
  const { calendarDays } = validatePayrollPeriod(startDate, endDate);

  const [user] = await dbInstance
    .select({
      id: users.id,
      companyId: users.companyId,
      name: users.name,
      branchId: users.branchId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.companyId) {
    throw new Error(`Empleado ${userId} no encontrado o sin empresa asignada.`);
  }

  // 1. Calculate tips
  const propinasSum = await dbInstance
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
  const contracts = await dbInstance
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
  const history = await dbInstance
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

  const salarioDiarioCents = contractResolution.dailySalaryCents;

  // 3. Resolve Attendance, Absences, Holidays and Operational Zone
  const attendance = await resolveAttendanceForPeriod({
    userId,
    companyId: user.companyId,
    startDate,
    endDate,
    effectiveDaysInPeriod: contractResolution.effectiveDaysInPeriod,
    branchId: options?.branchId ?? user.branchId,
    geographicZone: options?.geographicZone,
    dbInstance,
    ...options?.attendanceInput,
  });

  // Strict rejection of pending attendance
  if (attendance.hasPendingAttendance) {
    const first = attendance.pendingAttendanceDetails[0];
    throw new RangeError(
      `Asistencia pendiente en el período ${startDate} - ${endDate}: ` +
      `el empleado ${user.name || userId} tiene ${attendance.pendingAttendanceDetails.length} sesión(es) en estado PENDING, ACTIVE o sin aprobación del manager (ej. sesión ${first.sessionId} el ${first.date}: ${first.reason}).`
    );
  }

  // Deduct unpaid absences from base salary
  const unpaidDeductionCents = attendance.unpaidAbsenceDays * salarioDiarioCents;
  const baseSalaryCents = Math.max(0, contractResolution.baseSalaryCents - unpaidDeductionCents);

  // Worked holiday extra pay (LFT Art. 75): Salario doble ADICIONAL por laborar en día de descanso obligatorio
  const holidayPayCents = attendance.holidayDaysWorked * salarioDiarioCents * 2;
  const holidayDaysWorked = attendance.holidayDaysWorked;

  // Overtime resolution (LFT Arts. 61, 66, 67, 68)
  const overtimeBreakdown = await resolveOvertimeForPeriod({
    userId,
    companyId: user.companyId,
    startDate,
    endDate,
    dailySalaryCents: salarioDiarioCents,
    timezone: attendance.operationalZone.timezone,
    sessions: options?.attendanceInput?.sessions,
    approvals: options?.attendanceInput?.approvals,
    dbInstance,
  });
  const overtimePayCents = overtimeBreakdown.totalPayCents;

  // Vacation resolution (LFT Arts. 76, 79, 80 & 81)
  const vacationBreakdown = options?.vacationBreakdown ?? (await resolveVacationsForPeriod({
    userId,
    companyId: user.companyId,
    startDate,
    endDate,
    dailySalaryCents: salarioDiarioCents,
    vacationBonusPercent: options?.vacationBonusPercent,
    timezone: attendance.operationalZone.timezone,
    vacationRequests: options?.vacationsInput?.vacationRequests ?? (options?.attendanceInput?.vacations as any),
    vacationAccruals: options?.vacationsInput?.vacationAccruals,
    leaveBalances: options?.vacationsInput?.leaveBalances,
    dbInstance,
  }));
  const vacationPrimeCents = vacationBreakdown.vacationPrimeCents;
  const vacationDays = vacationBreakdown.vacationDaysTaken;

  const totalPercepcionesCents = baseSalaryCents + tipsCents + holidayPayCents + overtimePayCents + vacationPrimeCents;

  // Carga Patronal Real (35% IMSS/Infonavit/ISN sobre base + festivos) (Módulo 7.3)
  const employerSocialSecurityCents = Math.round((baseSalaryCents + holidayPayCents) * 0.35);
  const realLaborCostCents = totalPercepcionesCents + employerSocialSecurityCents;

  return {
    baseSalaryCents,
    propinasCents: tipsCents,
    holidayPayCents,
    overtimePayCents,
    overtimeBreakdown,
    vacationPrimeCents,
    vacationDays,
    vacationBreakdown,
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
    attendanceBreakdown: {
      calendarDays: attendance.calendarDays,
      effectiveDaysInPeriod: attendance.effectiveDaysInPeriod,
      approvedAttendanceDays: attendance.approvedAttendanceDays,
      holidayDaysWorked: attendance.holidayDaysWorked,
      holidayDaysRested: attendance.holidayDaysRested,
      vacationDays: attendance.vacationDays,
      paidLeaveDays: attendance.paidLeaveDays,
      otherPaidLeaveDays: attendance.otherPaidLeaveDays,
      unpaidAbsenceDays: attendance.unpaidAbsenceDays,
      payableDays: attendance.payableDays,
      hasPendingAttendance: attendance.hasPendingAttendance,
      operationalZone: attendance.operationalZone,
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
  overtimePayCents?: number;
  overtimeBreakdown?: OvertimeBreakdown;
  vacationPrimeCents?: number;
  vacationBreakdown?: VacationPeriodBreakdown;
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

  // SAT Concepto "019" ("Horas extra") bajo LISR Art. 93 Frac. I
  if (payroll.overtimePayCents && payroll.overtimePayCents > 0) {
    const UMA_DIARIA_CENTS_2026 = 11314;
    let exemptAmount = 0;

    if (payroll.overtimeBreakdown?.weeklyBreakdown && payroll.overtimeBreakdown.weeklyBreakdown.length > 0) {
      for (const week of payroll.overtimeBreakdown.weeklyBreakdown) {
        if (week.doublePayCents > 0) {
          const maxExemptWeek = 5 * UMA_DIARIA_CENTS_2026; // 56,570 cents
          const halfDouble = Math.floor(week.doublePayCents / 2);
          exemptAmount += Math.min(halfDouble, maxExemptWeek);
        }
      }
    } else {
      const maxExempt = 5 * UMA_DIARIA_CENTS_2026;
      const half = Math.floor(payroll.overtimePayCents / 2);
      exemptAmount = Math.min(half, maxExempt);
    }

    const taxedAmount = payroll.overtimePayCents - exemptAmount;

    desglosePercepciones.push({
      earningTypeCode: "019",
      code: "019",
      concept: "Horas extra (LFT Arts. 66-68)",
      taxedAmount,
      exemptAmount,
    });
  }

  // SAT Concepto "021" ("Prima vacacional") bajo LFT Art. 80 y LISR Art. 93 Frac. XIV
  // Exención fiscal: 15 veces la UMA diaria (15 * 11,314¢ = 169,710¢ en 2026)
  if (payroll.vacationPrimeCents && payroll.vacationPrimeCents > 0) {
    const UMA_DIARIA_CENTS_2026 = 11314;
    const maxExempt = 15 * UMA_DIARIA_CENTS_2026; // 169,710¢
    const exemptAmount = Math.min(payroll.vacationPrimeCents, maxExempt);
    const taxedAmount = payroll.vacationPrimeCents - exemptAmount;

    desglosePercepciones.push({
      earningTypeCode: "021",
      code: "021",
      concept: "Prima vacacional (Art. 80 LFT)",
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
  performedBy?: string,
  options?: {
    dbInstance?: any;
    geographicZone?: MinimumWageZone;
  }
) {
  validatePayrollPeriod(startDate, endDate);
  const dbInstance = options?.dbInstance ?? db;
  const isFrozen = await isPayrollPeriodFrozen(companyId, startDate, endDate, dbInstance);
  if (isFrozen) {
    throw new Error(`El período de nómina ${startDate} - ${endDate} ya fue completado y se encuentra congelado.`);
  }

  const scope = { companyId, actorId: performedBy };
  // 0. Pre-Flight Validation Check (Módulo 7.1 & 7.2)
  const validation = await validatePayrollPreStamping(companyId, startDate, endDate, undefined, options);
  if (!validation.canStamp) {
    const errorDetails = validation.validationErrors
      .filter((e) => e.severity === "BLOCKING")
      .map((e) => `${e.employeeName}: ${e.error}`)
      .join("; ");
    throw new Error(
      `Bloqueo de Nómina Pre-Timbrado: Existen ${validation.blockingErrorsCount} incidencias bloqueantes. [${errorDetails}]`
    );
  }

  const runExecutor = options?.dbInstance
    ? async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn(options.dbInstance)
    : <T>(fn: (tx: any) => Promise<T>): Promise<T> => withCompanyContext(scope, fn) as Promise<T>;

  // 1. Create a payroll run
  const [run] = (await runExecutor((tx) => tx.insert(payrollRuns).values({
    companyId,
    periodStart: startDate,
    periodEnd: endDate,
    status: 'PROCESSING'
  }).returning())) as any[];

  // 2. Get all active employees in company
  const activeStaff = await dbInstance
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

      const payrollCalc = await calculateEmployeePayroll(emp.userId, startDate, endDate, options);
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
      const [payslip] = (await runExecutor((tx) => tx.insert(payrollPayslips).values({
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
      }).returning())) as any[];
      
      results.push({ success: true, userId: emp.userId, payslip });
    } catch (err: any) {
      console.error(`Error procesando nómina para ${emp.userId}:`, err);
      results.push({ success: false, userId: emp.userId, error: err.message });
      // Guardar payslip con error
      let payrollCalc: any = null;
      try {
        payrollCalc = await calculateEmployeePayroll(emp.userId, startDate, endDate, options);
      } catch {
        payrollCalc = null;
      }
      await runExecutor((tx) => tx.insert(payrollPayslips).values({
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
  await runExecutor(async (tx) => {
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
