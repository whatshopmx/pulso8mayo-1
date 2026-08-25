import { db } from "@/lib/db";
import { shiftSessions, users, branches, holidays } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

export interface OvertimeRule {
    id: string;
    name: string;
    description: string;
    multiplier: number; // 1.0 = normal, 2.0 = double, 3.0 = triple
    appliesTo: "diurnal" | "nocturnal" | "weekly" | "holiday";
    thresholdMinutes: number; // Minutes after which this rule applies
    maxMinutes?: number; // Maximum minutes this rule can apply
}

export interface OvertimeCalculation {
    userId: string;
    userName: string;
    branchId: string;
    branchName: string;
    periodStart: Date;
    periodEnd: Date;
    regularMinutes: number;
    overtimeMinutes: {
        diurnal: number; // Horas extras diurnas (2x)
        nocturnal: number; // Horas extras nocturnas (3x)
        holiday: number; // Horas en día festivo (3x)
        weekly: number; // Horas extras semanales (2x)
    };
    totalOvertimeMinutes: number;
    sessions: ShiftSessionSummary[];
}

export interface ShiftSessionSummary {
    id: string;
    date: Date;
    startTime: Date;
    endTime: Date;
    totalWorkMinutes: number;
    isNightShift: boolean;
    isHoliday: boolean;
    isWeeklyOvertime: boolean;
    overtimeBreakdown: {
        diurnal: number;
        nocturnal: number;
        holiday: number;
        weekly: number;
    };
}

// Ley Federal de Trabajo - México
// Artículo 67: Jornada nocturna es de 22:00 a 06:00
// Artículo 68: Horas extras diurnas = 100% extra (2x)
// Artículo 69: Horas extras nocturnas = 150% extra (3x)
// Artículo 71: Día séptimo (domingo) = 25% extra mínimo
// After 48 hours/week = overtime

const OVERTIME_RULES: OvertimeRule[] = [
    {
        id: "diurnal_overtime",
        name: "Horas Extras Diurnas",
        description: "Horas extras trabajadas durante el día (6:00 - 22:00)",
        multiplier: 2.0,
        appliesTo: "diurnal",
        thresholdMinutes: 480, // After 8 hours normal work
        maxMinutes: undefined
    },
    {
        id: "nocturnal_overtime",
        name: "Horas Extras Nocturnas",
        description: "Horas extras trabajadas durante la noche (22:00 - 6:00)",
        multiplier: 3.0,
        appliesTo: "nocturnal",
        thresholdMinutes: 420, // After 7 hours night work
        maxMinutes: undefined
    },
    {
        id: "holiday_overtime",
        name: "Horas en Día Festivo",
        description: "Horas trabajadas en día festivo",
        multiplier: 3.0,
        appliesTo: "holiday",
        thresholdMinutes: 0, // All hours on holiday are 3x
        maxMinutes: undefined
    },
    {
        id: "weekly_overtime",
        name: "Horas Extras Semanales",
        description: "Horas trabajadas después de 48 horas semanales",
        multiplier: 2.0,
        appliesTo: "weekly",
        thresholdMinutes: 2880, // 48 hours * 60 minutes
        maxMinutes: undefined
    }
];

/** Normaliza un Date o un texto de fecha a la llave "YYYY-MM-DD". */
function toDayKey(value: Date | string): string {
    if (typeof value === "string") return value.slice(0, 10);
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

const NIGHT_SHIFT_START = 22; // 22:00
const NIGHT_SHIFT_END = 6; // 06:00
const MAX_WEEKLY_HOURS = 48;
const MAX_DAILY_HOURS_DIURNAL = 8;
const MAX_DAILY_HOURS_NOCTURNAL = 7;

export class LaborCalculator {
    /**
     * Calculate overtime for a user in a given period
     */
    static async calculateOvertime(
        userId: string,
        startDate: Date,
        endDate: Date
    ): Promise<OvertimeCalculation> {
        // Get user data
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user) {
            throw new Error(`User ${userId} not found`);
        }

        // Get shift sessions in period
        const sessions = await db.query.shiftSessions.findMany({
            where: and(
                eq(shiftSessions.userId, userId),
                gte(shiftSessions.startedAt, startDate),
                lte(shiftSessions.startedAt, endDate),
                eq(shiftSessions.status, "COMPLETED")
            ),
            orderBy: [shiftSessions.startedAt]
        });

        // Get user's branch
        const branch = user.branchId
            ? await db.query.branches.findFirst({
                  where: eq(branches.id, user.branchId)
              })
            : null;

        // Días festivos de la company, precargados una sola vez para todo el
        // período (antes esto era un TODO y la prima de festivo nunca aplicaba
        // salvo en domingo).
        const holidayDates = await this.loadHolidayDates(user.companyId);

        // Calculate weekly hours
        let weeklyMinutes = 0;
        const sessionSummaries: ShiftSessionSummary[] = [];

        for (const session of sessions) {
            const summary = this.analyzeSession(session, holidayDates);
            sessionSummaries.push(summary);
            weeklyMinutes += summary.totalWorkMinutes;
        }

        // Calculate overtime breakdown
        let totalDiurnal = 0;
        let totalNocturnal = 0;
        let totalHoliday = 0;
        let totalWeekly = 0;
        let totalRegular = 0;

        sessionSummaries.forEach(summary => {
            totalDiurnal += summary.overtimeBreakdown.diurnal;
            totalNocturnal += summary.overtimeBreakdown.nocturnal;
            totalHoliday += summary.overtimeBreakdown.holiday;
            totalWeekly += summary.overtimeBreakdown.weekly;

            // Regular minutes = total - overtime
            const sessionOvertime =
                summary.overtimeBreakdown.diurnal +
                summary.overtimeBreakdown.nocturnal +
                summary.overtimeBreakdown.holiday;
            totalRegular += Math.max(0, summary.totalWorkMinutes - sessionOvertime);
        });

        // Add weekly overtime
        if (weeklyMinutes > MAX_WEEKLY_HOURS * 60) {
            const weeklyOvertimeMinutes = weeklyMinutes - MAX_WEEKLY_HOURS * 60;
            totalWeekly += weeklyOvertimeMinutes;
        }

        const totalOvertime = totalDiurnal + totalNocturnal + totalHoliday + totalWeekly;

        return {
            userId,
            userName: user.name || "Unknown",
            branchId: user.branchId || "N/A",
            branchName: branch?.name || "N/A",
            periodStart: startDate,
            periodEnd: endDate,
            regularMinutes: totalRegular,
            overtimeMinutes: {
                diurnal: totalDiurnal,
                nocturnal: totalNocturnal,
                holiday: totalHoliday,
                weekly: totalWeekly
            },
            totalOvertimeMinutes: totalOvertime,
            sessions: sessionSummaries
        };
    }

    /**
     * Analyze a single shift session for overtime
     */
    private static analyzeSession(session: any, holidayDates?: Set<string>): ShiftSessionSummary {
        const startTime = new Date(session.startedAt);
        const endTime = session.endedAt ? new Date(session.endedAt) : new Date();
        const totalWorkMinutes = session.totalWorkMinutes || 0;

        // Check if night shift
        const isNightShift = this.isNightShift(startTime, endTime);

        // Check if holiday
        const isHoliday = this.isHoliday(startTime, holidayDates);

        // Check if weekly overtime (will be calculated in aggregate)
        const isWeeklyOvertime = false; // Calculated separately

        // Calculate overtime breakdown
        const breakdown = this.calculateSessionOvertime(
            startTime,
            endTime,
            totalWorkMinutes,
            isNightShift,
            isHoliday
        );

        return {
            id: session.id,
            date: startTime,
            startTime,
            endTime,
            totalWorkMinutes,
            isNightShift,
            isHoliday,
            isWeeklyOvertime,
            overtimeBreakdown: breakdown
        };
    }

    /**
     * Calculate overtime breakdown for a session
     */
    private static calculateSessionOvertime(
        startTime: Date,
        endTime: Date,
        totalMinutes: number,
        isNightShift: boolean,
        isHoliday: boolean
    ): { diurnal: number; nocturnal: number; holiday: number; weekly: number } {
        let diurnal = 0;
        let nocturnal = 0;
        let holiday = 0;
        const weekly = 0;

        // If holiday, all hours are 3x
        if (isHoliday) {
            holiday = totalMinutes;
            return { diurnal, nocturnal, holiday, weekly };
        }

        // Calculate night hours within the shift
        const nightMinutes = this.calculateNightMinutes(startTime, endTime);
        const dayMinutes = totalMinutes - nightMinutes;

        // Apply daily thresholds
        const maxDaily = isNightShift ? MAX_DAILY_HOURS_NOCTURNAL * 60 : MAX_DAILY_HOURS_DIURNAL * 60;

        if (totalMinutes <= maxDaily) {
            // No daily overtime
            nocturnal = nightMinutes;
            diurnal = dayMinutes;
        } else {
            // Overtime applies
            const overtimeMinutes = totalMinutes - maxDaily;

            if (isNightShift) {
                // Night shift: base hours are nocturnal, overtime is also nocturnal (3x)
                nocturnal = maxDaily + overtimeMinutes;
                diurnal = dayMinutes;
            } else {
                // Day shift: distribute overtime proportionally
                const nightRatio = nightMinutes / totalMinutes;
                const dayRatio = dayMinutes / totalMinutes;

                diurnal = dayMinutes + (overtimeMinutes * dayRatio);
                nocturnal = nightMinutes + (overtimeMinutes * nightRatio);
            }
        }

        return { diurnal, nocturnal, holiday, weekly };
    }

    /**
     * Calculate minutes worked during night shift (22:00 - 06:00)
     */
    private static calculateNightMinutes(start: Date, end: Date): number {
        let nightMinutes = 0;
        const current = new Date(start);

        while (current < end) {
            const hour = current.getHours();
            if (hour >= NIGHT_SHIFT_START || hour < NIGHT_SHIFT_END) {
                nightMinutes++;
            }
            current.setMinutes(current.getMinutes() + 1);
        }

        return nightMinutes;
    }

    /**
     * Check if shift spans night hours
     */
    private static isNightShift(start: Date, end: Date): boolean {
        const startHour = start.getHours();
        const endHour = end.getHours();

        // Shift is nocturnal if it's primarily during 22:00 - 06:00
        return startHour >= NIGHT_SHIFT_START || endHour < NIGHT_SHIFT_END;
    }

    /**
     * Check if date is a holiday.
     *
     * `holidayDates` es el conjunto de días festivos de la company en formato
     * "YYYY-MM-DD", precargado por `calculateOvertime` desde la tabla
     * `holidays` (una consulta por período, no una por sesión). Si no se
     * provee, solo aplica la regla de domingo.
     */
    private static isHoliday(date: Date, holidayDates?: Set<string>): boolean {
        // Domingo — día de descanso semanal (LFT art. 69).
        if (date.getDay() === 0) {
            return true;
        }

        // Día de descanso obligatorio declarado por la company (LFT art. 74).
        return holidayDates?.has(toDayKey(date)) ?? false;
    }

    /**
     * Load the company's holiday dates for a period as a "YYYY-MM-DD" set.
     * Devuelve un set vacío si el usuario no tiene company asignada.
     */
    private static async loadHolidayDates(
        companyId: string | null | undefined
    ): Promise<Set<string>> {
        if (!companyId) return new Set();
        const rows = await db
            .select({ date: holidays.date })
            .from(holidays)
            .where(eq(holidays.companyId, companyId));
        return new Set(rows.map(r => toDayKey(r.date)));
    }

    /**
     * Calculate overtime cost.
     *
     * @deprecated NO usar para costear nómina. `calculateOvertime` clasifica la
     * jornada COMPLETA en `overtimeMinutes.diurnal`/`.nocturnal` — no solo los
     * minutos que exceden el umbral (ver `calculateSessionOvertime`, rama
     * `totalMinutes <= maxDaily`). En consecuencia `regularMinutes` sale
     * siempre en 0 y este método multiplicaría la jornada ordinaria por 2x/3x
     * encima del sueldo base. Para el costo de nómina usar
     * `lib/services/labor-cost-service.ts`, que hace su propia clasificación.
     */
    static calculateOvertimeCost(
        hourlyRate: number,
        overtime: OvertimeCalculation
    ): {
        diurnalCost: number;
        nocturnalCost: number;
        holidayCost: number;
        weeklyCost: number;
        totalCost: number;
    } {
        const diurnalCost = (overtime.overtimeMinutes.diurnal / 60) * hourlyRate * 2;
        const nocturnalCost = (overtime.overtimeMinutes.nocturnal / 60) * hourlyRate * 3;
        const holidayCost = (overtime.overtimeMinutes.holiday / 60) * hourlyRate * 3;
        const weeklyCost = (overtime.overtimeMinutes.weekly / 60) * hourlyRate * 2;

        return {
            diurnalCost,
            nocturnalCost,
            holidayCost,
            weeklyCost,
            totalCost: diurnalCost + nocturnalCost + holidayCost + weeklyCost
        };
    }

    /**
     * Get overtime rules
     */
    static getOvertimeRules(): OvertimeRule[] {
        return OVERTIME_RULES;
    }

    /**
     * Format minutes to hours string
     */
    static formatMinutes(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        return `${hours}h ${mins}m`;
    }
}
