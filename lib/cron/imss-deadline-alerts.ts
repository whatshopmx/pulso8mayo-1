/**
 * IMSS Deadline Alerts Cron Job
 *
 * T22 — Alertas IMSS (Grupo Restaurantero, Fase 7)
 *
 * Corre diario (08:00) y notifica a OWNER/ADMIN de cada empresa cuando
 * una fecha límite IMSS (pago SUA mensual o modificación salarial
 * bimestral) está a 7, 3 o 1 días de vencer.
 *
 * La lógica de fechas es pura y vive en `./imss-deadlines`.
 */

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { and, inArray, isNotNull, isNull } from 'drizzle-orm';
import { NotificationDispatcher, type NotificationPayload } from '@/lib/services/notification-dispatcher';
import {
    formatDaysUntil,
    formatDeadlineDate,
    getDueDeadlines,
    getTodayInMx,
    type ImssDeadline,
} from './imss-deadlines';

const IMSS_MODULE_URL = '/dashboard/compliance/imss';

function buildPayloads(deadline: ImssDeadline, recipientIds: string[]): NotificationPayload[] {
    const deadlineDate = formatDeadlineDate(deadline.date);
    const daysLabel = formatDaysUntil(deadline.daysUntil);

    return recipientIds.map((userId) => ({
        userId,
        title: `Fecha límite IMSS en ${daysLabel}`,
        message: `${deadline.label} vence el ${deadlineDate}.`,
        type: deadline.daysUntil === 1 ? 'error' : 'warning',
        eventType: 'imss_deadline',
        actionUrl: IMSS_MODULE_URL,
        actionLabel: 'Abrir módulo IMSS',
        metadata: {
            deadlineType: deadline.type,
            deadlineLabel: deadline.label,
            deadlineDate,
            daysUntil: deadline.daysUntil,
            daysLabel,
        },
    }));
}

export async function checkImssDeadlines(now: Date = new Date()) {
    try {
        console.log('[IMSS Alerts] Starting check...');

        const today = getTodayInMx(now);
        const dueDeadlines = getDueDeadlines(today);

        if (dueDeadlines.length === 0) {
            console.log('[IMSS Alerts] No deadlines in alert windows today');
            return { success: true, today, deadlinesHit: 0, notificationsSent: 0 };
        }

        // Destinatarios: OWNER/ADMIN activos de todas las empresas
        const recipients = await db.query.users.findMany({
            where: and(
                inArray(users.role, ['OWNER', 'ADMIN']),
                isNull(users.deletedAt),
                isNotNull(users.companyId)
            ),
            columns: { id: true },
        });

        const recipientIds = recipients.map((r) => r.id);
        const payloads = dueDeadlines.flatMap((deadline) => buildPayloads(deadline, recipientIds));

        if (payloads.length > 0) {
            await NotificationDispatcher.sendBatchNotifications(payloads);
        }

        console.log(
            `[IMSS Alerts] ${dueDeadlines.length} deadline(s) in window, ` +
            `${payloads.length} notification(s) sent to ${recipientIds.length} recipient(s)`
        );

        return {
            success: true,
            today,
            deadlinesHit: dueDeadlines.length,
            recipients: recipientIds.length,
            notificationsSent: payloads.length,
        };
    } catch (error) {
        console.error('[IMSS Alerts] Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
