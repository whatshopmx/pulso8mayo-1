/**
 * LFT Conflict Detector
 * 
 * Detects scheduling conflicts with Mexican Labor Law (LFT)
 * such as 6+ consecutive work days, weekly hour limits, etc.
 */

import { format, differenceInDays, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import { LaborCalendarRulesService } from './labor-calendar-rules';

export type LFTConflictType = 
    | 'SIXTH_DAY_VIOLATION'
    | 'WEEKLY_LIMIT_EXCEEDED'
    | 'DAILY_LIMIT_EXCEEDED'
    | 'INSUFFICIENT_REST'
    | 'MISSING_REST_DAY';

export type ConflictSeverity = 'LEVE' | 'GRAVE' | 'MUY_GRAVE';

export interface LFTConflict {
    id: string;
    userId: string;
    userName: string;
    type: LFTConflictType;
    severity: ConflictSeverity;
    description: string;
    article: string;
    dates: Date[];
    details: Record<string, any>;
}

export interface ShiftSchedule {
    userId: string;
    userName: string;
    date: Date;
    startTime: string;
    endTime: string;
    workHours: number;
}

export class LFTConflictDetector {
    /**
     * Detect all LFT conflicts in a schedule
     */
    static detectConflicts(schedules: ShiftSchedule[]): LFTConflict[] {
        const conflicts: LFTConflict[] = [];

        // Group schedules by employee
        const byEmployee = this.groupByEmployee(schedules);

        // Check each employee's schedule
        for (const [userId, shifts] of Object.entries(byEmployee)) {
            // Check 6 consecutive days
            conflicts.push(...this.detectSixthDayViolation(userId, shifts));

            // Check weekly hours limit (48 hours max)
            conflicts.push(...this.detectWeeklyLimitViolation(userId, shifts));

            // Check daily hours limit (8 hours max for day shift)
            conflicts.push(...this.detectDailyLimitViolation(userId, shifts));

            // Check insufficient rest between shifts (12 hours min)
            conflicts.push(...this.detectInsufficientRestViolation(userId, shifts));
        }

        return conflicts;
    }

    /**
     * Group schedules by employee
     */
    private static groupByEmployee(schedules: ShiftSchedule[]): Record<string, ShiftSchedule[]> {
        const grouped: Record<string, ShiftSchedule[]> = {};

        schedules.forEach(schedule => {
            if (!grouped[schedule.userId]) {
                grouped[schedule.userId] = [];
            }
            grouped[schedule.userId].push(schedule);
        });

        // Sort each employee's shifts by date
        for (const userId of Object.keys(grouped)) {
            grouped[userId].sort((a, b) => 
                new Date(a.date).getTime() - new Date(b.date).getTime()
            );
        }

        return grouped;
    }

    /**
     * Detect 6+ consecutive work days without rest
     */
    private static detectSixthDayViolation(
        userId: string,
        shifts: ShiftSchedule[]
    ): LFTConflict[] {
        const conflicts: LFTConflict[] = [];

        if (shifts.length < 6) return conflicts;

        // Find consecutive day sequences
        let consecutiveDays = 1;
        let sequenceStart = 0;
        let maxSequence = 1;
        let maxSequenceStart = 0;

        for (let i = 1; i < shifts.length; i++) {
            const currentDate = new Date(shifts[i].date);
            const previousDate = new Date(shifts[i - 1].date);
            const daysDiff = differenceInDays(currentDate, previousDate);

            if (daysDiff === 1) {
                consecutiveDays++;
                
                if (consecutiveDays > maxSequence) {
                    maxSequence = consecutiveDays;
                    maxSequenceStart = sequenceStart;
                }
            } else {
                consecutiveDays = 1;
                sequenceStart = i;
            }
        }

        // If 6+ consecutive days, create conflict
        if (maxSequence >= 6) {
            const conflictDates = shifts.slice(maxSequenceStart, maxSequenceStart + maxSequence).map(s => s.date);
            
            conflicts.push({
                id: `sixth-day-${userId}-${format(shifts[maxSequenceStart].date, 'yyyy-MM-dd')}`,
                userId,
                userName: shifts[maxSequenceStart].userName,
                type: 'SIXTH_DAY_VIOLATION',
                severity: maxSequence >= 7 ? 'MUY_GRAVE' : 'GRAVE',
                description: `${maxSequence} días consecutivos sin descanso (máx 5 días permitidos)`,
                article: 'Artículo 69, 70 LFT',
                dates: conflictDates,
                details: {
                    consecutiveDays: maxSequence,
                    maxAllowed: 5,
                    restDayRequired: true,
                },
            });
        }

        return conflicts;
    }

    /**
     * Detect weekly hours exceeding legal limits (dynamic 2026-2030 timeline)
     */
    private static detectWeeklyLimitViolation(
        userId: string,
        shifts: ShiftSchedule[]
    ): LFTConflict[] {
        const conflicts: LFTConflict[] = [];

        // Group shifts by week
        const byWeek: Record<string, ShiftSchedule[]> = {};

        shifts.forEach(shift => {
            const weekStart = format(startOfWeek(shift.date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
            if (!byWeek[weekStart]) {
                byWeek[weekStart] = [];
            }
            byWeek[weekStart].push(shift);
        });

        // Check each week
        for (const [weekStart, weekShifts] of Object.entries(byWeek)) {
            const shiftYear = new Date(weekStart).getFullYear();
            const yearlyRules = LaborCalendarRulesService.getRulesForYear(shiftYear);
            const maxAllowedWeeklyHours = yearlyRules.maxWeeklyHours;
            const totalHours = weekShifts.reduce((sum, shift) => sum + shift.workHours, 0);

            if (totalHours > maxAllowedWeeklyHours) {
                const weekEnd = format(endOfWeek(new Date(weekStart), { weekStartsOn: 1 }), 'yyyy-MM-dd');
                
                conflicts.push({
                    id: `weekly-limit-${userId}-${weekStart}`,
                    userId,
                    userName: shifts[0].userName,
                    type: 'WEEKLY_LIMIT_EXCEEDED',
                    severity: totalHours > (maxAllowedWeeklyHours + 6) ? 'MUY_GRAVE' : 'GRAVE',
                    description: `${totalHours.toFixed(1)} horas en la semana del ${weekStart} (máx ${maxAllowedWeeklyHours} horas legal en ${shiftYear})`,
                    article: 'Artículo 61, 123 LFT',
                    dates: weekShifts.map(s => s.date),
                    details: {
                        weekStart,
                        weekEnd,
                        totalHours,
                        maxHours: maxAllowedWeeklyHours,
                        excessHours: totalHours - maxAllowedWeeklyHours,
                    },
                });
            }
        }

        return conflicts;
    }

    /**
     * Detect daily hours exceeding limits
     */
    private static detectDailyLimitViolation(
        userId: string,
        shifts: ShiftSchedule[]
    ): LFTConflict[] {
        const conflicts: LFTConflict[] = [];

        shifts.forEach(shift => {
            if (shift.workHours > 8) {
                conflicts.push({
                    id: `daily-limit-${userId}-${format(shift.date, 'yyyy-MM-dd')}`,
                    userId,
                    userName: shift.userName,
                    type: 'DAILY_LIMIT_EXCEEDED',
                    severity: shift.workHours > 10 ? 'MUY_GRAVE' : 'GRAVE',
                    description: `${shift.workHours.toFixed(1)} horas el ${format(shift.date, 'dd/MM/yyyy')} (máx 8 horas jornada diurna)`,
                    article: 'Artículo 61 LFT',
                    dates: [shift.date],
                    details: {
                        workHours: shift.workHours,
                        maxHours: 8,
                        excessHours: shift.workHours - 8,
                    },
                });
            }
        });

        return conflicts;
    }

    /**
     * Detect insufficient rest between shifts (less than 12 hours)
     */
    private static detectInsufficientRestViolation(
        userId: string,
        shifts: ShiftSchedule[]
    ): LFTConflict[] {
        const conflicts: LFTConflict[] = [];

        for (let i = 1; i < shifts.length; i++) {
            const currentShift = shifts[i];
            const previousShift = shifts[i - 1];

            // Calculate hours between end of previous shift and start of current shift
            const previousEnd = this.parseTime(previousShift.date, previousShift.endTime);
            const currentStart = this.parseTime(currentShift.date, currentShift.startTime);

            const hoursBetween = (currentStart.getTime() - previousEnd.getTime()) / (1000 * 60 * 60);

            if (hoursBetween < 12 && hoursBetween > 0) {
                conflicts.push({
                    id: `insufficient-rest-${userId}-${format(currentShift.date, 'yyyy-MM-dd')}`,
                    userId,
                    userName: currentShift.userName,
                    type: 'INSUFFICIENT_REST',
                    severity: hoursBetween < 8 ? 'MUY_GRAVE' : 'GRAVE',
                    description: `Solo ${hoursBetween.toFixed(1)} horas de descanso entre turnos (mínimo 12 horas)`,
                    article: 'Artículo 63 LFT',
                    dates: [previousShift.date, currentShift.date],
                    details: {
                        restHours: hoursBetween,
                        minRestHours: 12,
                        previousShiftEnd: previousShift.endTime,
                        currentShiftStart: currentShift.startTime,
                    },
                });
            }
        }

        return conflicts;
    }

    /**
     * Parse date and time into Date object
     */
    private static parseTime(date: Date, time: string): Date {
        const [hours, minutes] = time.split(':').map(Number);
        const result = new Date(date);
        result.setHours(hours, minutes, 0, 0);
        return result;
    }

    /**
     * Export conflicts to human-readable report
     */
    static generateReport(conflicts: LFTConflict[]): string {
        let report = 'REPORTE DE CONFLICTOS LFT\n';
        report += '='.repeat(50) + '\n\n';
        report += `Total de Conflictos: ${conflicts.length}\n\n`;

        // Group by severity
        const bySeverity = {
            MUY_GRAVE: conflicts.filter(c => c.severity === 'MUY_GRAVE'),
            GRAVE: conflicts.filter(c => c.severity === 'GRAVE'),
            LEVE: conflicts.filter(c => c.severity === 'LEVE'),
        };

        report += `🚨 Muy Graves: ${bySeverity.MUY_GRAVE.length}\n`;
        report += `🔴 Graves: ${bySeverity.GRAVE.length}\n`;
        report += `⚠️ Leves: ${bySeverity.LEVE.length}\n\n`;

        // List all conflicts
        report += 'DETALLE DE CONFLICTOS\n';
        report += '-'.repeat(50) + '\n\n';

        conflicts.forEach((conflict, index) => {
            report += `${index + 1}. [${conflict.severity}] ${conflict.type}\n`;
            report += `   Empleado: ${conflict.userName}\n`;
            report += `   Descripción: ${conflict.description}\n`;
            report += `   Artículo: ${conflict.article}\n`;
            report += `   Fechas: ${conflict.dates.map(d => format(d, 'dd/MM/yyyy')).join(', ')}\n\n`;
        });

        return report;
    }
}
