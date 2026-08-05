// P&L Fase 1 — Nómina real por sucursal.
//
// Sustituye la constante sectorial `ventas × 0.262` por el costo derivado de los
// contratos y la asistencia realmente capturada.
//
// Escalera de cálculo (se usa el mejor método con datos disponibles y se declara
// cuál se usó — docs/plan-pnl-real.md Fase 1):
//
//   1. MEASURED      — contratos vigentes × días con `shift_sessions` COMPLETED,
//                      más horas extra y prima de día festivo.
//   2. CONTRACT_ONLY — sin turnos capturados: contratos vigentes × días
//                      laborables del período. Es plantilla teórica, no
//                      asistencia; se declara como tal.
//   3. NO_DATA       — sin contratos. El fallback sectorial NO vive aquí: lo
//                      aplica `pnl-service`, que es quien conoce las ventas.
//
// Rendimiento: 4 consultas por company, independientes del número de sucursales
// (requisito de la Fase 4). NO llama a `LaborCalculator.calculateOvertime`, que
// es por-usuario (N consultas) y además clasifica la jornada completa como hora
// extra — ver la nota @deprecated en `calculateOvertimeCost`.
//
// Alcance contable: esto es sueldo BRUTO, no costo patronal. No incluye IMSS,
// INFONAVIT ni provisiones (aguinaldo, vacaciones, prima vacacional). Decisión
// P1 del plan: bruto en v1 con nota al pie explícita. El contador del cliente
// verá un número mayor que este, y la nota tiene que anticiparlo.

import { db } from "@/lib/db";
import {
  branches,
  employeeContracts,
  holidays,
  salaryHistory,
  shiftSessions,
  users,
} from "@/lib/db/schema";
import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

export type LaborCostSource = "MEASURED" | "CONTRACT_ONLY" | "SECTOR_DEFAULT" | "NO_DATA";

export interface BranchLaborCost {
  branchId: string;
  /** Días trabajados × sueldo diario vigente. */
  baseCostCents: number;
  /** Horas extra (LFT art. 68/69) + prima de día festivo (art. 75). */
  overtimeCostCents: number;
  totalCostCents: number;
  headcount: number;
  source: LaborCostSource;
  /** % de días-empleado esperados del período que tienen sesión COMPLETED. */
  coveragePercent: number;
  note: string;
}

// --- Constantes LFT / IMSS -------------------------------------------------

/** Jornada diurna máxima (LFT art. 61) — fallback cuando el contrato no declara horario. */
const DEFAULT_WORK_HOURS = 8;
/** Divisor mensual→diario del salario (LFT art. 89 / práctica IMSS). */
const MONTHLY_TO_DAILY_DIVISOR = 30;
/** Jornada nocturna: 22:00–06:00 (LFT art. 60). */
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;
/** Horas extra diurnas se pagan al doble (art. 68); nocturnas al triple (art. 69). */
const OVERTIME_MULTIPLIER_DIURNAL = 2;
const OVERTIME_MULTIPLIER_NOCTURNAL = 3;
/** Trabajar en día de descanso obligatorio: salario doble ADICIONAL (art. 75). */
const HOLIDAY_PREMIUM_MULTIPLIER = 2;
/** Máximo de horas extra ordinarias por día (LFT art. 66). */
const MAX_ORDINARY_OVERTIME_MINUTES = 3 * 60;
/** El excedente sobre el art. 66 se paga al triple (LFT art. 68, segundo párrafo). */
const EXCESS_OVERTIME_MULTIPLIER = 3;

/**
 * Tope de plausibilidad por empleado y día.
 *
 * No es una regla legal: es un guardarraíl contra datos inconsistentes. En la
 * base actual hay empleados con 17 `shift_sessions` COMPLETED marcadas en el
 * mismo día (todas con el mismo `started_at`), que sumadas dan >120 h en 24 h.
 * Sin este tope, una captura duplicada se convierte en un costo de nómina
 * inventado — exactamente el defecto que este plan corrige. Los días recortados
 * se cuentan y se declaran en la nota.
 */
const MAX_PLAUSIBLE_DAILY_MINUTES = 16 * 60;

/**
 * Si `salary_history.newSalary` es al menos este múltiplo del `baseSalary`
 * diario del contrato, se interpreta como sueldo MENSUAL y se divide entre 30.
 *
 * No es una suposición gratuita: en la base actual `newSalary` replica
 * `monthlySalary` (4,500,000¢ = $45,000/mes) mientras `baseSalary` es diario
 * (150,000¢ = $1,500/día) — una razón de 30×. Tomar `newSalary` como diario,
 * que es lo que sugiere una lectura literal del esquema, inflaría la nómina 30
 * veces. La regla se decide contra el contrato del propio empleado, así que
 * funciona igual para un tenant que sí guarde el diario (razón ≈ 1).
 */
const MONTHLY_SALARY_RATIO_THRESHOLD = 20;

// --- Utilidades de fecha (todo en UTC para no depender del TZ del servidor) --

/** Acepta "YYYY-MM-DD" o un ISO completo y devuelve "YYYY-MM-DD". */
function toDayString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/** Día ISO de la semana: 1 = lunes … 7 = domingo (convención de `work_days`). */
function isoWeekday(day: string): number {
  const jsDay = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return jsDay === 0 ? 7 : jsDay;
}

const DEFAULT_TIMEZONE = "America/Mexico_City";
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function localFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * Día calendario y hora en la zona de la sucursal.
 *
 * `shift_sessions.started_at` es un timestamp sin zona: leerlo en UTC desplaza
 * los turnos de noche al día siguiente y clasifica como "nocturno" un turno de
 * las 21:30 hora de México (03:30 UTC). Para un producto HORECA mexicano eso
 * cambia el multiplicador de horas extra de 2x a 3x, así que se resuelve contra
 * `branches.timezone`.
 */
function localParts(date: Date, timeZone: string): { day: string; hour: number } {
  const parts = localFormatter(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24; // en-CA puede devolver "24" a medianoche
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour };
}

function eachDay(startDay: string, endDay: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startDay}T00:00:00Z`);
  const end = new Date(`${endDay}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// --- Tipos internos --------------------------------------------------------

interface ContractRow {
  userId: string;
  branchId: string | null;
  baseSalary: number;
  monthlySalary: number | null;
  workDays: number[] | null;
  workStartTime: string | null;
  workEndTime: string | null;
  breakDurationMinutes: number | null;
  startDate: Date;
  endDate: Date | null;
}

interface SalaryRow {
  userId: string;
  newSalary: number;
  effectiveDate: Date;
}

interface SessionRow {
  userId: string;
  branchId: string;
  startedAt: Date;
  totalWorkMinutes: number | null;
}

/**
 * Minutos de jornada estándar del contrato. Si el contrato no declara horario
 * (que es el caso en todos los contratos capturados hoy), cae a la jornada
 * diurna máxima de la LFT. `contractDeclaresHours` se propaga a la nota para que
 * el cliente sepa que ese 8 no salió de su contrato.
 */
function standardMinutes(c: ContractRow): { minutes: number; declared: boolean } {
  if (c.workStartTime && c.workEndTime) {
    const [sh, sm] = c.workStartTime.split(":").map(Number);
    const [eh, em] = c.workEndTime.split(":").map(Number);
    if ([sh, sm, eh, em].every((n) => Number.isFinite(n))) {
      let span = eh * 60 + em - (sh * 60 + sm);
      if (span <= 0) span += 24 * 60; // turno que cruza medianoche
      const net = span - (c.breakDurationMinutes ?? 0);
      if (net > 0) return { minutes: net, declared: true };
    }
  }
  return { minutes: DEFAULT_WORK_HOURS * 60, declared: false };
}

/**
 * Sueldo diario vigente en `day`: último `salary_history.newSalary` con
 * `effectiveDate <= day`, normalizado a diario; fallback a `baseSalary`.
 */
function dailySalaryCents(c: ContractRow, history: SalaryRow[], day: string): number {
  const dayTs = new Date(`${day}T23:59:59Z`).getTime();
  let latest: SalaryRow | null = null;
  for (const h of history) {
    if (h.effectiveDate.getTime() > dayTs) continue;
    if (!latest || h.effectiveDate.getTime() > latest.effectiveDate.getTime()) latest = h;
  }
  if (!latest) return c.baseSalary;

  const looksMonthly =
    c.baseSalary > 0 && latest.newSalary >= c.baseSalary * MONTHLY_SALARY_RATIO_THRESHOLD;
  return looksMonthly
    ? Math.round(latest.newSalary / MONTHLY_TO_DAILY_DIVISOR)
    : latest.newSalary;
}

/** Días del período en que este contrato estaba vigente y tocaba trabajar. */
function expectedWorkDays(c: ContractRow, days: string[]): string[] {
  const start = toDayString(c.startDate);
  const end = c.endDate ? toDayString(c.endDate) : null;
  const workDays = c.workDays && c.workDays.length > 0 ? new Set(c.workDays) : null;

  return days.filter((d) => {
    if (d < start) return false;
    if (end && d > end) return false;
    return workDays ? workDays.has(isoWeekday(d)) : true;
  });
}

/**
 * Costo de nómina por sucursal para el período [startDate, endDate] (inclusive).
 *
 * `startDate` / `endDate` aceptan "YYYY-MM-DD" o ISO completo.
 * Devuelve una entrada por sucursal de la company, incluidas las que no tienen
 * contratos (con `source: 'NO_DATA'`), para que `pnl-service` no tenga que
 * adivinar la diferencia entre "cero" y "sin datos".
 */
export async function getLaborCostByBranch(
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<BranchLaborCost[]> {
  const startDay = toDayString(startDate);
  const endDay = toDayString(endDate);
  const periodStart = new Date(`${startDay}T00:00:00Z`);
  const periodEnd = new Date(`${endDay}T23:59:59.999Z`);
  const days = eachDay(startDay, endDay);

  // 1/4 — Sucursales de la company (define el universo de salida).
  const branchRows = await db
    .select({ id: branches.id, timezone: branches.timezone })
    .from(branches)
    .where(eq(branches.companyId, companyId));
  const branchIds = branchRows.map((b) => b.id);
  const tzByBranch = new Map(branchRows.map((b) => [b.id, b.timezone || DEFAULT_TIMEZONE]));

  const empty = (branchId: string, note: string): BranchLaborCost => ({
    branchId,
    baseCostCents: 0,
    overtimeCostCents: 0,
    totalCostCents: 0,
    headcount: 0,
    source: "NO_DATA",
    coveragePercent: 0,
    note,
  });

  if (branchIds.length === 0) return [];

  // 2/4 — Contratos vigentes en el período, con la sucursal resuelta.
  //
  // `employee_contracts.branch_id` está vacío en los datos reales (los 7
  // contratos capturados lo tienen NULL), así que la sucursal se resuelve con
  // COALESCE contra `users.branch_id`. Sin esto la nómina sale en cero para
  // todas las sucursales aunque haya contratos.
  const contracts: ContractRow[] = await db
    .select({
      userId: employeeContracts.userId,
      branchId: sql<string | null>`COALESCE(${employeeContracts.branchId}, ${users.branchId})`,
      baseSalary: employeeContracts.baseSalary,
      monthlySalary: employeeContracts.monthlySalary,
      workDays: employeeContracts.workDays,
      workStartTime: employeeContracts.workStartTime,
      workEndTime: employeeContracts.workEndTime,
      breakDurationMinutes: employeeContracts.breakDurationMinutes,
      startDate: employeeContracts.startDate,
      endDate: employeeContracts.endDate,
    })
    .from(employeeContracts)
    .innerJoin(users, eq(users.id, employeeContracts.userId))
    .where(
      and(
        eq(employeeContracts.companyId, companyId),
        ne(employeeContracts.status, "TERMINATED"),
        lte(employeeContracts.startDate, periodEnd),
        or(isNull(employeeContracts.endDate), gte(employeeContracts.endDate, periodStart)),
      ),
    );

  const scoped = contracts.filter((c) => c.branchId && branchIds.includes(c.branchId));

  if (scoped.length === 0) {
    return branchIds.map((id) =>
      empty(id, "Sin contratos vigentes en el período: la nómina no se puede calcular con tus datos"),
    );
  }

  // 3/4 — Historial salarial de esos empleados (sueldo vigente por fecha).
  const userIds = [...new Set(scoped.map((c) => c.userId))];
  const history: SalaryRow[] = await db
    .select({
      userId: salaryHistory.userId,
      newSalary: salaryHistory.newSalary,
      effectiveDate: salaryHistory.effectiveDate,
    })
    .from(salaryHistory)
    .where(and(inArray(salaryHistory.userId, userIds), lte(salaryHistory.effectiveDate, periodEnd)));

  const historyByUser = new Map<string, SalaryRow[]>();
  for (const h of history) {
    const list = historyByUser.get(h.userId) ?? [];
    list.push(h);
    historyByUser.set(h.userId, list);
  }

  // 4/4 — Asistencia real y días festivos de la company.
  const [sessions, holidayRows] = await Promise.all([
    db
      .select({
        userId: shiftSessions.userId,
        branchId: shiftSessions.branchId,
        startedAt: shiftSessions.startedAt,
        totalWorkMinutes: shiftSessions.totalWorkMinutes,
      })
      .from(shiftSessions)
      .where(
        and(
          inArray(shiftSessions.branchId, branchIds),
          eq(shiftSessions.status, "COMPLETED"),
          gte(shiftSessions.startedAt, periodStart),
          lte(shiftSessions.startedAt, periodEnd),
        ),
      ) as Promise<SessionRow[]>,
    db
      .select({ date: holidays.date })
      .from(holidays)
      .where(eq(holidays.companyId, companyId)),
  ]);

  const holidaySet = new Set(holidayRows.map((h) => toDayString(h.date)));

  // --- Ensamblado en memoria ---------------------------------------------

  const contractsByBranch = new Map<string, ContractRow[]>();
  for (const c of scoped) {
    const list = contractsByBranch.get(c.branchId!) ?? [];
    list.push(c);
    contractsByBranch.set(c.branchId!, list);
  }

  // Sesiones agrupadas por sucursal → usuario → día. Un empleado con dos
  // sesiones el mismo día cobra un solo día base; las horas se suman.
  const sessionsByBranch = new Map<string, Map<string, Map<string, number>>>();
  // Hora local de inicio por (usuario, día) para clasificar jornada nocturna.
  const startHourByKey = new Map<string, number>();

  for (const s of sessions) {
    const { day, hour } = localParts(s.startedAt, tzByBranch.get(s.branchId) ?? DEFAULT_TIMEZONE);

    const byUser = sessionsByBranch.get(s.branchId) ?? new Map();
    const byDay = byUser.get(s.userId) ?? new Map<string, number>();
    byDay.set(day, (byDay.get(day) ?? 0) + (s.totalWorkMinutes ?? 0));
    byUser.set(s.userId, byDay);
    sessionsByBranch.set(s.branchId, byUser);

    const key = `${s.userId}|${day}`;
    if (!startHourByKey.has(key)) startHourByKey.set(key, hour);
  }

  return branchIds.map((branchId) => {
    const branchContracts = contractsByBranch.get(branchId) ?? [];
    if (branchContracts.length === 0) {
      return empty(branchId, "Sin contratos asignados a esta sucursal en el período");
    }

    const headcount = new Set(branchContracts.map((c) => c.userId)).size;
    const byUser = sessionsByBranch.get(branchId) ?? new Map<string, Map<string, number>>();

    let expectedTotal = 0;
    let workedTotal = 0;
    let baseCostCents = 0;
    let overtimeCostCents = 0;
    let holidayDaysWorked = 0;
    let implausibleDays = 0;
    let anyContractDeclaresHours = false;
    let contractOnlyCostCents = 0;

    for (const c of branchContracts) {
      const expected = expectedWorkDays(c, days);
      expectedTotal += expected.length;

      const { minutes: stdMinutes, declared } = standardMinutes(c);
      if (declared) anyContractDeclaresHours = true;

      const userHistory = historyByUser.get(c.userId) ?? [];

      // Plantilla teórica: lo que costaría si todos asistieran los días que
      // marca su contrato. Es el número del escalón CONTRACT_ONLY.
      for (const day of expected) {
        contractOnlyCostCents += dailySalaryCents(c, userHistory, day);
      }

      const workedDays = byUser.get(c.userId);
      if (!workedDays) continue;

      for (const [day, rawMinutes] of workedDays) {
        // Un turno fuera de la vigencia del contrato no se paga contra él.
        const contractStart = toDayString(c.startDate);
        const contractEnd = c.endDate ? toDayString(c.endDate) : null;
        if (day < contractStart) continue;
        if (contractEnd && day > contractEnd) continue;

        workedTotal += 1;
        const daily = dailySalaryCents(c, userHistory, day);
        baseCostCents += daily;

        // Prima de día festivo (LFT art. 75): salario doble ADICIONAL al del
        // día. El día base ya se sumó arriba, así que aquí va solo la prima.
        if (holidaySet.has(day)) {
          overtimeCostCents += daily * HOLIDAY_PREMIUM_MULTIPLIER;
          holidayDaysWorked += 1;
        }

        // Guardarraíl de plausibilidad antes de costear nada.
        const workedMinutes = Math.min(rawMinutes, MAX_PLAUSIBLE_DAILY_MINUTES);
        if (rawMinutes > MAX_PLAUSIBLE_DAILY_MINUTES) implausibleDays += 1;

        // Horas extra: solo los minutos POR ENCIMA de la jornada estándar.
        const extraMinutes = Math.max(0, workedMinutes - stdMinutes);
        if (extraMinutes > 0) {
          const hourlyRate = daily / (stdMinutes / 60);
          const startHour = startHourByKey.get(`${c.userId}|${day}`) ?? 12;
          const isNight = startHour >= NIGHT_START_HOUR || startHour < NIGHT_END_HOUR;

          // Hasta 3 h/día al doble (diurna) o triple (nocturna) — art. 66/68/69.
          const ordinaryMinutes = Math.min(extraMinutes, MAX_ORDINARY_OVERTIME_MINUTES);
          const ordinaryMultiplier = isNight
            ? OVERTIME_MULTIPLIER_NOCTURNAL
            : OVERTIME_MULTIPLIER_DIURNAL;
          overtimeCostCents += Math.round(
            (ordinaryMinutes / 60) * hourlyRate * ordinaryMultiplier,
          );

          // El excedente sobre el máximo legal se paga al triple — art. 68.
          const excessMinutes = extraMinutes - ordinaryMinutes;
          if (excessMinutes > 0) {
            overtimeCostCents += Math.round(
              (excessMinutes / 60) * hourlyRate * EXCESS_OVERTIME_MULTIPLIER,
            );
          }
        }
      }
    }

    const coveragePercent =
      expectedTotal > 0 ? Math.min(100, Math.round((workedTotal / expectedTotal) * 100)) : 0;

    const hoursNote = anyContractDeclaresHours
      ? ""
      : ` Jornada estándar de ${DEFAULT_WORK_HOURS}h asumida (LFT art. 61): tus contratos no tienen horario capturado.`;
    const grossNote =
      " Es sueldo bruto: no incluye IMSS, INFONAVIT ni provisiones (aguinaldo, vacaciones, prima).";

    if (workedTotal > 0) {
      const holidayNote =
        holidayDaysWorked > 0 ? ` Incluye prima de ${holidayDaysWorked} día(s) festivo(s).` : "";
      const implausibleNote =
        implausibleDays > 0
          ? ` ${implausibleDays} día(s) con más de ${MAX_PLAUSIBLE_DAILY_MINUTES / 60}h registradas ` +
            `(posibles turnos duplicados): las horas se acotaron para no inflar el costo. Revisa la captura de asistencia.`
          : "";
      return {
        branchId,
        baseCostCents,
        overtimeCostCents,
        totalCostCents: baseCostCents + overtimeCostCents,
        headcount,
        source: "MEASURED" as const,
        coveragePercent,
        note:
          `${workedTotal} de ${expectedTotal} días-empleado capturados con turno completado ` +
          `(${headcount} empleados).${holidayNote}${implausibleNote}${hoursNote}${grossNote}`,
      };
    }

    return {
      branchId,
      baseCostCents: contractOnlyCostCents,
      overtimeCostCents: 0,
      totalCostCents: contractOnlyCostCents,
      headcount,
      source: "CONTRACT_ONLY" as const,
      coveragePercent: 0,
      note:
        `Plantilla contratada, no asistencia real: ${headcount} empleados × ${expectedTotal} ` +
        `días-empleado laborables. Sin turnos capturados en el período, así que no incluye ` +
        `faltas ni horas extra.${hoursNote}${grossNote}`,
    };
  });
}
