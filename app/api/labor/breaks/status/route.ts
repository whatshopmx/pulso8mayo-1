import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { shiftSessions, breakLogs, users, branches } from '@/lib/db/schema';
import { eq, and, gte, lte, isNull, desc } from 'drizzle-orm';
import { startOfDay, endOfDay, differenceInMinutes } from 'date-fns';
import { isApiError } from '@/lib/api/error';
import {
    alcanceDeListado,
    descansosDeSesiones,
    requireAttendanceAccess,
} from '@/lib/labor/attendance-scope';

/**
 * GET /api/labor/breaks/status
 * Get break status for all active employees
 *
 * Antes sólo exigía sesión: los filtros opcionales se aplicaban tal cual y sin
 * `branchId` la respuesta traía la asistencia activa de **todas** las
 * empresas, con nombre y teléfono de cada empleado (H02). Ahora la condición de
 * empresa y de alcance va siempre en la consulta.
 */
export async function GET(req: NextRequest) {
    try {
        const actor = await requireAttendanceAccess();

        const { searchParams } = new URL(req.url);
        const branchId = searchParams.get('branchId');

        const today = new Date();
        const dayStart = startOfDay(today);
        const dayEnd = endOfDay(today);

        // Get all active shift sessions for today
        const sessionConditions = [
            // Siempre primero: es la condición que ningún filtro del cliente
            // puede quitar ni ampliar.
            await alcanceDeListado(actor, branchId),
            eq(shiftSessions.status, 'ACTIVE'),
            gte(shiftSessions.startedAt, dayStart),
            lte(shiftSessions.startedAt, dayEnd),
        ];

        const activeSessions = await db
            .select({
                id: shiftSessions.id,
                userId: shiftSessions.userId,
                userName: users.name,
                userPhone: users.phone,
                branchId: shiftSessions.branchId,
                branchName: branches.name,
                startedAt: shiftSessions.startedAt,
                totalWorkMinutes: shiftSessions.totalWorkMinutes,
                totalBreakMinutes: shiftSessions.totalBreakMinutes,
            })
            .from(shiftSessions)
            .leftJoin(users, eq(shiftSessions.userId, users.id))
            .leftJoin(branches, eq(shiftSessions.branchId, branches.id))
            .where(and(...sessionConditions));

        // Get today's breaks for all active sessions
        const sessionIds = activeSessions.map(s => s.id);

        let breaks = [];
        if (sessionIds.length > 0) {
            breaks = await db
                .select({
                    id: breakLogs.id,
                    sessionId: breakLogs.sessionId,
                    startTime: breakLogs.startTime,
                    endTime: breakLogs.endTime,
                    durationMinutes: breakLogs.durationMinutes,
                    type: breakLogs.type,
                    isCompliant: breakLogs.isCompliant,
                    complianceNotes: breakLogs.complianceNotes,
                })
                .from(breakLogs)
                .where(and(
                    // Antes pedía los descansos del día enteros y descartaba en
                    // memoria los que no eran de estas sesiones: no filtraba nada
                    // hacia el cliente, pero leía los de todas las empresas.
                    descansosDeSesiones(sessionIds),
                    gte(breakLogs.startTime, dayStart),
                    lte(breakLogs.startTime, dayEnd)
                ));
        }

        // Build employee break status
        const employees = activeSessions.map(session => {
            const sessionBreaks = breaks.filter(b => b.sessionId === session.id);
            const activeBreak = sessionBreaks.find(b => !b.endTime);
            const completedBreaks = sessionBreaks.filter(b => b.endTime);

            const totalBreakMinutes = completedBreaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
            const minutesWorked = session.totalWorkMinutes || 
                differenceInMinutes(new Date(), session.startedAt);

            // Check compliance issues
            const complianceIssues: string[] = [];
            let complianceStatus: 'COMPLIANT' | 'WARNING' | 'NON_COMPLIANT' = 'COMPLIANT';

            // Check if worked > 5 hours without break
            if (minutesWorked > 300 && totalBreakMinutes === 0) {
                complianceIssues.push('>5 horas sin break');
                complianceStatus = 'NON_COMPLIANT';
            } else if (minutesWorked > 240 && totalBreakMinutes === 0) {
                complianceIssues.push('4+ horas sin break');
                complianceStatus = 'WARNING';
            }

            // Check if any break was too short (< 30 min)
            const shortBreaks = completedBreaks.filter(b => (b.durationMinutes || 0) < 30);
            if (shortBreaks.length > 0) {
                complianceIssues.push(`${shortBreaks.length} break(s) < 30 min`);
                if (complianceStatus === 'COMPLIANT') {
                    complianceStatus = 'WARNING';
                }
            }

            // Check if break was missed during long shift
            if (minutesWorked > 480 && completedBreaks.length < 2) {
                complianceIssues.push('Break insuficiente para jornada > 8h');
                complianceStatus = 'NON_COMPLIANT';
            }

            return {
                userId: session.userId,
                userName: session.userName || 'Desconocido',
                userPhone: session.userPhone || '',
                branchId: session.branchId,
                branchName: session.branchName || 'Desconocida',
                shiftStarted: session.startedAt,
                minutesWorked,
                lastBreakStart: activeBreak?.startTime || completedBreaks[completedBreaks.length - 1]?.startTime || null,
                lastBreakEnd: activeBreak?.endTime || completedBreaks[completedBreaks.length - 1]?.endTime || null,
                lastBreakDuration: activeBreak?.durationMinutes || completedBreaks[completedBreaks.length - 1]?.durationMinutes || null,
                totalBreakMinutes,
                breakCount: completedBreaks.length,
                hasActiveBreak: !!activeBreak,
                complianceStatus,
                complianceIssues,
                lastWhatsAppNotification: null, // TODO: Fetch from breakReminderLogs
            };
        });

        return NextResponse.json({
            employees,
            summary: {
                total: employees.length,
                onBreak: employees.filter(e => e.hasActiveBreak).length,
                compliant: employees.filter(e => e.complianceStatus === 'COMPLIANT').length,
                warning: employees.filter(e => e.complianceStatus === 'WARNING').length,
                nonCompliant: employees.filter(e => e.complianceStatus === 'NON_COMPLIANT').length,
                missedBreaks: employees.filter(e => 
                    e.minutesWorked > 300 && e.totalBreakMinutes === 0
                ).length,
            },
        });
    } catch (error) {
        // Un rechazo de alcance sale con su status y su mensaje; sin esto el
        // operador veía "Error interno" por no tener sucursal asignada.
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error('Error fetching break status:', error);
        return NextResponse.json(
            { error: 'Error interno' },
            { status: 500 }
        );
    }
}
