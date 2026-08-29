import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { breakReminderLogs, shiftSessions, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NotificationDispatcher } from '@/lib/services/notification-dispatcher';
import { headers } from 'next/headers';

/**
 * POST /api/labor/breaks/send-bulk-reminders
 * Send WhatsApp break reminders to all employees with pending or overdue breaks
 */
export async function POST(req: NextRequest) {
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });
        
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const { branchId } = body;

        // Fetch active shift sessions
        const conditions = [eq(shiftSessions.status, 'ACTIVE')];
        if (branchId && branchId !== 'all') {
            conditions.push(eq(shiftSessions.branchId, branchId));
        }

        const activeSessions = await db.query.shiftSessions.findMany({
            where: and(...conditions),
        });

        // Filter sessions that have worked >300 minutes (5 hours) or have 0 break minutes
        const overdueSessions = activeSessions.filter(s => {
            const worked = s.totalWorkMinutes || 0;
            const breakMins = s.totalBreakMinutes || 0;
            return worked >= 240 && breakMins === 0; // >4 hours without break
        });

        if (overdueSessions.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No hay colaboradores con descanso pendiente en este momento.',
                remindedCount: 0,
            });
        }

        let sentCount = 0;
        const now = new Date();

        for (const s of overdueSessions) {
            try {
                // Get user info
                const user = await db.query.users.findFirst({
                    where: eq(users.id, s.userId),
                });

                if (user) {
                    await NotificationDispatcher.sendNotification({
                        userId: s.userId,
                        title: '⏰ Recordatorio de Descanso (NOM-035 / LFT)',
                        message: `Hola ${user.name}, llevas más de 4 horas continuas de turno. Recuerda tomar tu descanso reglamentario de 30 minutos.\n\nEnvía "pausa" por WhatsApp para registrarlo.`,
                        type: 'warning',
                        eventType: 'shift_reminder',
                        actionUrl: `/dashboard/labor/breaks`,
                        actionLabel: 'Ver Descansos',
                        metadata: {
                            hoursWorked: Math.round((s.totalWorkMinutes || 0) / 60),
                            branchId: s.branchId,
                        },
                    });

                    await db.insert(breakReminderLogs).values({
                        sessionId: s.id,
                        userId: s.userId,
                        branchId: s.branchId,
                        reminderType: 'BREAK_DUE',
                        message: `Recordatorio masivo enviado a ${user.name}`,
                        channel: 'WHATSAPP',
                        triggeredAt: now,
                        sentAt: now,
                    });

                    sentCount++;
                }
            } catch (err) {
                console.error(`Failed to send reminder for user ${s.userId}:`, err);
            }
        }

        return NextResponse.json({
            success: true,
            message: `Se enviaron ${sentCount} recordatorios por WhatsApp.`,
            remindedCount: sentCount,
        });
    } catch (error) {
        console.error('Error sending bulk break reminders:', error);
        return NextResponse.json(
            { error: 'Error al enviar recordatorios masivos' },
            { status: 500 }
        );
    }
}
