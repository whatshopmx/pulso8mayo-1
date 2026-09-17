import { db } from "@/lib/db";
import { breakLogs, breakComplianceRules, breakReminderLogs, shiftSessions } from "@/lib/db/schema";
import { eq, and, gte, lte, isNull } from "drizzle-orm";
import { whatsappClient } from "@/lib/whatsapp/client-factory";

export interface BreakComplianceConfig {
    minBreakDuration: number;
    maxContinuousWork: number;
    mealBreakRequired: boolean;
    mealBreakMinDuration: number;
    maxDailyHours: number;
    maxWeeklyHours: number;
    minRestBetweenShifts: number;
    lateTolerance: number;
    earlyDepartureTolerance: number;
    enableBreakReminders: boolean;
    reminderInterval: number;
    enableOvertimeAlerts: boolean;
    overtimeAlertThreshold: number;
}

export interface BreakSession {
    id: string;
    sessionId: string;
    startTime: Date;
    endTime: Date | null;
    durationMinutes: number | null;
    type: string;
    isCompliant: boolean;
    complianceNotes: string | null;
}

export class BreakManagementService {
    /**
     * Get compliance rules for a company
     */
    static async getComplianceRules(companyId: string): Promise<BreakComplianceConfig | null> {
        const rules = await db.query.breakComplianceRules.findFirst({
            where: and(
                eq(breakComplianceRules.companyId, companyId),
                eq(breakComplianceRules.isActive, true)
            )
        });

        if (!rules) return null;

        return {
            minBreakDuration: rules.minBreakDuration || 30,
            maxContinuousWork: rules.maxContinuousWork || 300,
            mealBreakRequired: rules.mealBreakRequired ?? true,
            mealBreakMinDuration: rules.mealBreakMinDuration || 30,
            maxDailyHours: rules.maxDailyHours || 8,
            maxWeeklyHours: rules.maxWeeklyHours || 48,
            minRestBetweenShifts: rules.minRestBetweenShifts || 12,
            lateTolerance: rules.lateTolerance || 10,
            earlyDepartureTolerance: rules.earlyDepartureTolerance || 10,
            enableBreakReminders: rules.enableBreakReminders ?? true,
            reminderInterval: rules.reminderInterval || 120,
            enableOvertimeAlerts: rules.enableOvertimeAlerts ?? true,
            overtimeAlertThreshold: rules.overtimeAlertThreshold || 30,
        };
    }

    /**
     * Start a break for a user
     */
    static async startBreak(
        userId: string,
        sessionId: string,
        type: string = 'STANDARD'
    ): Promise<BreakSession> {
        // Check if there's already an active break
        const activeBreak = await db.query.breakLogs.findFirst({
            where: and(
                eq(breakLogs.sessionId, sessionId),
                isNull(breakLogs.endTime)
            )
        });

        if (activeBreak) {
            throw new Error("User already has an active break");
        }

        // Create new break log
        const [newBreak] = await db.insert(breakLogs).values({
            sessionId,
            startTime: new Date(),
            type,
            isCompliant: true
        }).returning();

        return newBreak as BreakSession;
    }

    /**
     * End a break for a user
     */
    static async endBreak(userId: string, sessionId: string): Promise<BreakSession> {
        // Find active break
        const activeBreak = await db.query.breakLogs.findFirst({
            where: and(
                eq(breakLogs.sessionId, sessionId),
                isNull(breakLogs.endTime)
            )
        });

        if (!activeBreak) {
            throw new Error("No active break found");
        }

        const endTime = new Date();
        const durationMs = endTime.getTime() - activeBreak.startTime.getTime();
        const durationMinutes = Math.floor(durationMs / 60000);

        // Check compliance
        const session = await db.query.shiftSessions.findFirst({
            where: eq(shiftSessions.id, sessionId)
        });

        let isCompliant = true;
        let complianceNotes: string | null = null;

        if (session) {
            const config = await this.getComplianceRules(session.branchId);
            
            if (config) {
                // Check if break is long enough
                if (durationMinutes < config.minBreakDuration) {
                    isCompliant = false;
                    complianceNotes = `Break demasiado corto (${durationMinutes}m < ${config.minBreakDuration}m mínimo)`;
                }

    // Check if meal break is required and this is a long shift
    const workMinutes = session.totalWorkMinutes || 0;
    if (config.mealBreakRequired && workMinutes > 300 && activeBreak.type === 'STANDARD' && durationMinutes < config.mealBreakMinDuration) {
      isCompliant = false;
      complianceNotes = (complianceNotes || "") + " Se requiere break de comida de al menos 30 minutos para jornadas > 5 horas.";
    }
            }
        }

        // Update break log
        const [updatedBreak] = await db.update(breakLogs).set({
            endTime,
            durationMinutes,
            isCompliant,
            complianceNotes
        }).where(eq(breakLogs.id, activeBreak.id)).returning();

        // Update session total break minutes
        if (session) {
            const currentTotal = session.totalBreakMinutes || 0;
            await db.update(shiftSessions).set({
                totalBreakMinutes: currentTotal + durationMinutes
            }).where(eq(shiftSessions.id, sessionId));
        }

        return updatedBreak as BreakSession;
    }

    /**
     * Check break compliance for a session
     */
    static async checkBreakCompliance(sessionId: string): Promise<{
        isCompliant: boolean;
        issues: string[];
        breaks: BreakSession[];
    }> {
        const session = await db.query.shiftSessions.findFirst({
            where: eq(shiftSessions.id, sessionId)
        });

        if (!session) {
            throw new Error("Session not found");
        }

        const breaks = await db.query.breakLogs.findMany({
            where: eq(breakLogs.sessionId, sessionId),
            orderBy: [breakLogs.startTime]
        });

        const issues: string[] = [];
        let isCompliant = true;

        const config = await this.getComplianceRules(session.branchId || '');

        if (!config) {
            return { isCompliant: true, issues: [], breaks: breaks as BreakSession[] };
        }

        // Check if breaks were taken
        const totalBreakMinutes = breaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
        
        if (config.maxContinuousWork > 0 && session.totalWorkMinutes) {
            const continuousWorkPeriods = this.calculateContinuousWorkPeriods(
                session.startedAt,
                session.endedAt || new Date(),
                breaks
            );

            for (const period of continuousWorkPeriods) {
                if (period > config.maxContinuousWork) {
                    isCompliant = false;
                    issues.push(`Período de trabajo continuo de ${Math.floor(period / 60)}h ${period % 60}m excede el máximo de ${Math.floor(config.maxContinuousWork / 60)}h ${config.maxContinuousWork % 60}m`);
                }
            }
        }

        // Check meal break requirement
        if (config.mealBreakRequired && (session.totalWorkMinutes || 0) > 300) {
            const mealBreak = breaks.find(b => b.type === 'MEAL' && (b.durationMinutes || 0) >= config.mealBreakMinDuration);
            if (!mealBreak) {
                isCompliant = false;
                issues.push("No se registró break de comida de al menos 30 minutos");
            }
        }

        // Update break compliance flags
        for (const breakLog of breaks) {
            if (!breakLog.isCompliant) {
                isCompliant = false;
                if (breakLog.complianceNotes) {
                    issues.push(breakLog.complianceNotes);
                }
            }
        }

        return { isCompliant, issues, breaks: breaks as BreakSession[] };
    }

    /**
     * Calculate continuous work periods between breaks
     */
    private static calculateContinuousWorkPeriods(
        startTime: Date,
        endTime: Date,
        breaks: any[]
    ): number[] {
        const periods: number[] = [];
        let lastBreakEnd = startTime;

        for (const breakLog of breaks.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())) {
            if (breakLog.startTime) {
                const workPeriod = (breakLog.startTime.getTime() - lastBreakEnd.getTime()) / 60000;
                periods.push(workPeriod);
                if (breakLog.endTime) {
                    lastBreakEnd = breakLog.endTime;
                }
            }
        }

        // Add final work period
        const finalPeriod = (endTime.getTime() - lastBreakEnd.getTime()) / 60000;
        periods.push(finalPeriod);

        return periods;
    }

    /**
     * Send break reminder to user
     */
    static async sendBreakReminder(
        userId: string,
        sessionId: string,
        reminderType: 'BREAK_DUE' | 'BREAK_OVERDUE' | 'MEAL_BREAK',
        phoneNumber?: string
    ): Promise<void> {
        const session = await db.query.shiftSessions.findFirst({
            where: eq(shiftSessions.id, sessionId)
        });

        if (!session) return;

        // Log the reminder
        const [reminder] = await db.insert(breakReminderLogs).values({
            sessionId,
            userId,
            branchId: session.branchId,
            reminderType,
            message: this.getReminderMessage(reminderType),
            channel: 'WHATSAPP'
        }).returning();

        // Send WhatsApp message if phone number provided
        if (phoneNumber) {
            try {
                // Get WhatsApp session for the company
                const companySession = `pulso_${session.branchId}`;
		await whatsappClient.sendMessage({
                    sessionId: companySession,
                    to: phoneNumber,
                    message: this.getReminderMessage(reminderType)
                });
                await db.update(breakReminderLogs).set({
                    sentAt: new Date()
                }).where(eq(breakReminderLogs.id, reminder.id));
            } catch (error) {
                console.error("Error sending break reminder:", error);
            }
        }
    }

    /**
     * Get reminder message based on type
     */
    private static getReminderMessage(type: string): string {
        switch (type) {
            case 'BREAK_DUE':
                return "⏰ Es hora de tomar un descanso. Recuerda registrar tu break para cumplir con la normativa laboral.";
            case 'BREAK_OVERDUE':
                return "⚠️ Has estado trabajando continuamente por más tiempo del recomendado. Por favor toma un break y regístralo.";
            case 'MEAL_BREAK':
                return "🍽️ Es hora de tu comida. Recuerda tomar al menos 30 minutos de descanso para tu bienestar.";
            default:
                return "⏰ Recordatorio: No olvides registrar tus breaks durante tu jornada laboral.";
        }
    }

    /**
     * Get all breaks for a session
     */
    static async getSessionBreaks(sessionId: string): Promise<BreakSession[]> {
        const breaks = await db.query.breakLogs.findMany({
            where: eq(breakLogs.sessionId, sessionId),
            orderBy: [breakLogs.startTime]
        });

        return breaks as BreakSession[];
    }

    /**
     * Get breaks by date range for reporting
     */
    static async getBreaksByDateRange(
        branchId: string,
        startDate: Date,
        endDate: Date
    ): Promise<BreakSession[]> {
        const sessions = await db.query.shiftSessions.findMany({
            where: and(
                eq(shiftSessions.branchId, branchId),
                gte(shiftSessions.startedAt, startDate),
                lte(shiftSessions.startedAt, endDate)
            )
        });

        const sessionIds = sessions.map(s => s.id);

        if (sessionIds.length === 0) {
            return [];
        }

        const breaks = await db.query.breakLogs.findMany({
            where: and(
                eq(breakLogs.sessionId, sessionIds[0]), // This needs to be improved with inArray
                isNull(breakLogs.endTime)
            )
        });

        return breaks as BreakSession[];
    }

    /**
     * Auditoría de cumplimiento Ley Silla (Arts. 132 Fracc. V Bis y 133 Fracc. XVIII LFT)
     * Verifica que colaboradores en turnos continuos hayan tenido pausas periódicas
     * de descanso para mitigar fatiga por bipedestación prolongada en HORECA.
     */
    static async auditLeySillaCompliance(
        branchId: string,
        startDate: Date,
        endDate: Date
    ): Promise<{
        totalSessions: number;
        compliantSessions: number;
        nonCompliantSessions: number;
        complianceRate: number;
        violations: Array<{
            sessionId: string;
            userId: string;
            date: Date;
            continuousWorkMinutes: number;
            reason: string;
        }>;
    }> {
        const sessions = await db.query.shiftSessions.findMany({
            where: and(
                eq(shiftSessions.branchId, branchId),
                gte(shiftSessions.startedAt, startDate),
                lte(shiftSessions.startedAt, endDate),
                eq(shiftSessions.status, "COMPLETED")
            )
        });

        let compliantCount = 0;
        const violations: Array<{
            sessionId: string;
            userId: string;
            date: Date;
            continuousWorkMinutes: number;
            reason: string;
        }> = [];

        for (const session of sessions) {
            const validation = await this.checkBreakCompliance(session.id);
            if (validation.isCompliant) {
                compliantCount++;
            } else {
                violations.push({
                    sessionId: session.id,
                    userId: session.userId,
                    date: new Date(session.startedAt),
                    continuousWorkMinutes: session.totalWorkMinutes || 0,
                    reason: validation.issues.join("; ") || "Incumplimiento de pausas periódicas (Ley Silla)"
                });
            }
        }

        const total = sessions.length;
        const nonCompliant = total - compliantCount;

        return {
            totalSessions: total,
            compliantSessions: compliantCount,
            nonCompliantSessions: nonCompliant,
            complianceRate: total > 0 ? Math.round((compliantCount / total) * 100) : 100,
            violations
        };
    }
}
