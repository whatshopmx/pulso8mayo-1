import { parseISO, differenceInMinutes, differenceInDays, format, startOfDay, endOfDay, eachDayOfInterval, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";

export interface Shift {
  id: string;
  userId: string;
  startTime: string;
  endTime: string;
  role?: string;
  branchId?: string;
}

export interface ShiftSession {
  id: string;
  userId: string;
  plannedShiftId?: string;
  clockIn?: string;
  clockOut?: string;
  totalBreakMinutes: number;
  overtimeMinutes: number;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
}

export interface BreakLog {
  id: string;
  sessionId: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  isCompliant: boolean;
}

export interface OvertimeCalculation {
  totalMinutes: number;
  rate1Minutes: number;
  rate2Minutes: number;
  rate3Minutes: number;
}

export interface ComplianceRule {
  weeklyHours: number;
  workDays: number;
  toleranceMinutes: number;
  minBreakDuration: number;
  maxContinuousWork: number;
  mealBreakRequired: boolean;
  minRestBetweenShifts: number;
}

export const DEFAULT_COMPLIANCE_RULES: ComplianceRule = {
  weeklyHours: 40,
  workDays: 5,
  toleranceMinutes: 15,
  minBreakDuration: 30,
  maxContinuousWork: 300,
  mealBreakRequired: true,
  minRestBetweenShifts: 12,
};

export function calculateOvertime(
  totalMinutes: number,
  weeklyOvertimeAccumulated: number = 0
): OvertimeCalculation {
  const regularMinutes = 8 * 60;
  const beyondRegular = Math.max(0, totalMinutes - regularMinutes);

  // LFT Art. 84/87 (decisión 2026-08-24): toda hora extra se paga mínimo al
  // doble; las primeras 9 h extra de la semana van a doble y el excedente a
  // triple. `weeklyOvertimeAccumulated` trae lo ya pagado a doble en la
  // semana y recorta ese allowance. rate1 queda deprecado en 0: no existe
  // categoría legal de extra a tarifa normal.
  const doubleAllowance = Math.max(0, 540 - weeklyOvertimeAccumulated);
  const rate2Minutes = Math.min(beyondRegular, doubleAllowance);
  const rate3Minutes = beyondRegular - rate2Minutes;

  return {
    totalMinutes: beyondRegular,
    rate1Minutes: 0,
    rate2Minutes,
    rate3Minutes,
  };
}

export function calculateDailyOvertime(workMinutes: number, scheduledMinutes: number = 480): number {
  return Math.max(0, workMinutes - scheduledMinutes);
}

export function calculateWeeklyOvertime(dailyOvertime: number[]): OvertimeCalculation {
  // Las entradas YA son minutos de extra diaria: sumarlas y pasárselas a
  // calculateOvertime tal cual restaba OTRO VEZ las 8h regulares y toda
  // semana con <8h de extra acumulada devolvía bandas en cero. Se ancla el
  // pool a una jornada completa para reusar la misma repartición de bandas.
  const totalOvertime = dailyOvertime.reduce((sum, m) => sum + Math.max(0, m), 0);
  return calculateOvertime(8 * 60 + totalOvertime);
}

export function validateBreakCompliance(
  workMinutes: number,
  breakMinutes: number,
  rules: ComplianceRule = DEFAULT_COMPLIANCE_RULES
): { isCompliant: boolean; message?: string } {
  const shiftDurationHours = workMinutes / 60;

  if (shiftDurationHours >= 8 && rules.mealBreakRequired) {
    if (breakMinutes < 30) {
      return {
        isCompliant: false,
        message: `Jornada de ${shiftDurationHours.toFixed(1)}h requiere mínimo 30 min de descanso (tienes ${breakMinutes} min)`,
      };
    }
  } else if (shiftDurationHours >= 5 && shiftDurationHours < 6) {
    if (breakMinutes < 15) {
      return {
        isCompliant: false,
        message: `Jornada de ${shiftDurationHours.toFixed(1)}h requiere mínimo 15 min de descanso`,
      };
    }
  }

  if (workMinutes > rules.maxContinuousWork) {
    return {
      isCompliant: false,
      message: `Trabajo continuo de ${workMinutes} min excede límite de ${rules.maxContinuousWork} min sin descanso`,
    };
  }

  return { isCompliant: true };
}

export function checkShiftConflict(shifts: Shift[]): Array<{ shiftId: string; message: string; type: "error" | "warning" }> {
  const conflicts: Array<{ shiftId: string; message: string; type: "error" | "warning" }> = [];

  // Se agrupa sólo por usuario, no por fecha de inicio: un turno que cruza
  // medianoche cae en el grupo de su día de arranque y los traslapes contra
  // turnos del día siguiente eran invisibles. Ordenando por inicio basta
  // comparar pares i<j con start_j < end_i para saber si se traslapan,
  // independiente del orden en que lleguen los turnos.
  const groupedByUser: Record<string, Shift[]> = {};
  shifts.forEach(shift => {
    if (!groupedByUser[shift.userId]) groupedByUser[shift.userId] = [];
    groupedByUser[shift.userId].push(shift);
  });

  Object.values(groupedByUser).forEach(userShifts => {
    const sorted = [...userShifts].sort(
      (a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime()
    );

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const s1 = sorted[i];
        const s2 = sorted[j];
        const s1End = parseISO(s1.endTime);
        const s2Start = parseISO(s2.startTime);

        if (s2Start < s1End) {
          conflicts.push({
            shiftId: s1.id,
            message: `Turno se superpone con otro turno (${format(s2Start, "HH:mm")})`,
            type: "error",
          });
        }
      }
    }
  });

  shifts.forEach(shift => {
    const start = parseISO(shift.startTime);
    const end = parseISO(shift.endTime);
    const hours = differenceInMinutes(end, start) / 60;

    if (hours > 12) {
      conflicts.push({
        shiftId: shift.id,
        message: `Turno de ${hours.toFixed(1)}h excede límite de 12 horas`,
        type: "warning",
      });
    }

    if (hours > 13) {
      conflicts.push({
        shiftId: shift.id,
        message: `Turno de ${hours.toFixed(1)}h excede límite legal de 13 horas (NOM-035)`,
        type: "error",
      });
    }
  });

  return conflicts;
}

export function checkRestBetweenShifts(
  shifts: Shift[],
  rules: ComplianceRule = DEFAULT_COMPLIANCE_RULES
): Array<{ shiftId: string; message: string; type: "error" | "warning" }> {
  const conflicts: Array<{ shiftId: string; message: string; type: "error" | "warning" }> = [];
  
  const sortedShifts = [...shifts].sort(
    (a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime()
  );

  for (let i = 0; i < sortedShifts.length - 1; i++) {
    const current = sortedShifts[i];
    const next = sortedShifts[i + 1];

    if (current.userId !== next.userId) continue;

    const restHours = differenceInMinutes(
      parseISO(next.startTime),
      parseISO(current.endTime)
    ) / 60;

    if (restHours < rules.minRestBetweenShifts) {
      conflicts.push({
        shiftId: next.id,
        message: `Solo ${restHours.toFixed(1)}h de descanso entre turnos (mínimo ${rules.minRestBetweenShifts}h requerido)`,
        type: "error",
      });
    }
  }

  return conflicts;
}

export function aggregateWeeklyHours(
  shifts: Shift[]
): { userId: string; totalMinutes: number; byDay: Record<string, number> }[] {
  const byUser: Record<string, { totalMinutes: number; byDay: Record<string, number> }> = {};

  shifts.forEach(shift => {
    if (!byUser[shift.userId]) {
      byUser[shift.userId] = { totalMinutes: 0, byDay: {} };
    }

    const minutes = differenceInMinutes(
      parseISO(shift.endTime),
      parseISO(shift.startTime)
    );
    const dayKey = format(parseISO(shift.startTime), "yyyy-MM-dd");

    byUser[shift.userId].totalMinutes += minutes;
    byUser[shift.userId].byDay[dayKey] = (byUser[shift.userId].byDay[dayKey] || 0) + minutes;
  });

  return Object.entries(byUser).map(([userId, data]) => ({
    userId,
    ...data,
  }));
}

export function generateOvertimeAlert(
  workedMinutes: number,
  thresholdMinutes: number = 30
): { shouldAlert: boolean; message: string } {
  if (workedMinutes >= 480) {
    const overtime = workedMinutes - 480;
    if (overtime >= thresholdMinutes) {
      return {
        shouldAlert: true,
        message: `${Math.floor(overtime / 60)}h ${overtime % 60}min de horas extra acumuladas`,
      };
    }
  }
  return { shouldAlert: false, message: "" };
}

export function formatOvertimeRate(minutes: number, rate: 1 | 2 | 3): string {
  const rateLabel = rate === 1 ? "Normal (1x)" : rate === 2 ? "Doble (2x)" : "Triple (3x)";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}min ${rateLabel}`;
}

export function getComplianceStatus(
  weeklyMinutes: number,
  rules: ComplianceRule = DEFAULT_COMPLIANCE_RULES
): "compliant" | "warning" | "violation" {
  const maxWeekly = rules.weeklyHours * 60;
  const maxWithOvertime = maxWeekly + (3 * 60 * 3);

  if (weeklyMinutes > maxWithOvertime) return "violation";
  if (weeklyMinutes > maxWeekly + (1 * 60)) return "warning";
  return "compliant";
}

export function generateWeeklyReport(
  shifts: Shift[],
  sessions: ShiftSession[],
  rules: ComplianceRule = DEFAULT_COMPLIANCE_RULES
) {
  const userHours = aggregateWeeklyHours(shifts);
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  const totals = userHours.map(user => {
    const userSessions = sessions.filter(s => s.userId === user.userId);
    const totalBreak = userSessions.reduce((sum, s) => sum + s.totalBreakMinutes, 0);
    const totalOvertime = userSessions.reduce((sum, s) => sum + s.overtimeMinutes, 0);
    const overtime = calculateOvertime(user.totalMinutes);

    return {
      userId: user.userId,
      totalMinutes: user.totalMinutes,
      weeklyHours: (user.totalMinutes / 60).toFixed(1),
      breakMinutes: totalBreak,
      overtimeMinutes: totalOvertime,
      overtimeBreakdown: overtime,
      status: getComplianceStatus(user.totalMinutes, rules),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    weekStart: weekStart.toISOString(),
    totals,
    summary: {
      totalEmployees: totals.length,
      totalHours: totals.reduce((sum, t) => sum + t.totalMinutes, 0) / 60,
      compliantCount: totals.filter(t => t.status === "compliant").length,
      warningCount: totals.filter(t => t.status === "warning").length,
      violationCount: totals.filter(t => t.status === "violation").length,
    },
  };
}