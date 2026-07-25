/**
 * Labor Command Handler
 *
 * Handles labor-related WhatsApp commands (clock in/out, breaks, status)
 */

import { db } from '@/lib/db';
import { shiftSessions, breakLogs, users } from '@/lib/db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { whatsappClient } from '../client-factory';

export interface LaborCommandResult {
    success: boolean;
    message: string;
    data?: any;
}

import { inngest } from "@/lib/inngest/client";

export interface GeolocationData {
    latitude: number;
    longitude: number;
    accuracy?: number;
}

export class LaborHandler {
    /**
     * Handle clock in command
     */
    async handleClockIn(
        userId: string, 
        branchId: string, 
        sessionId: string, 
        phoneNumber: string,
        geolocation?: GeolocationData
    ): Promise<LaborCommandResult> {
        try {
            // Check if user already has an active session (Fast check before triggering workflow)
            const activeSession = await db.query.shiftSessions.findFirst({
                where: and(
                    eq(shiftSessions.userId, userId),
                    eq(shiftSessions.status, 'ACTIVE')
                ),
            });

            if (activeSession) {
                return {
                    success: false,
                    message: `⚠️ Ya tienes una sesión activa desde las ${this.formatTime(activeSession.startedAt)}.
Si quieres registrar salida, envía: *salida*`,
                };
            }

            await inngest.send({
                name: "shift/clock-in.requested",
                data: { userId, branchId, phoneNumber, geolocation },
            });

            return {
                success: true,
                message: `⌛ Procesando entrada...
Te enviaremos confirmación en un momento.`,
            };
        } catch (error) {
            console.error('[LaborHandler] Clock in error:', error);
            return {
                success: false,
                message: '❌ Error al registrar entrada. Por favor intenta de nuevo.',
            };
        }
    }

    /**
     * Handle clock out command
     */
    async handleClockOut(
        userId: string, 
        sessionId: string, 
        phoneNumber: string,
        geolocation?: GeolocationData
    ): Promise<LaborCommandResult> {
        try {
            await inngest.send({
                name: "shift/clock-out.requested",
                data: { userId, phoneNumber, geolocation },
            });

            return {
                success: true,
                message: `⌛ Procesando salida...`,
            };
        } catch (error) {
            console.error('[LaborHandler] Clock out error:', error);
            return {
                success: false,
                message: '❌ Error al registrar salida. Por favor intenta de nuevo.',
            };
        }
    }

    /**
     * Handle break start command
     */
    async handleBreakStart(
        userId: string, 
        sessionId: string, 
        phoneNumber: string,
        geolocation?: GeolocationData
    ): Promise<LaborCommandResult> {
        try {
            await inngest.send({
                name: "shift/break.start.requested",
                data: { userId, phoneNumber, geolocation },
            });

            return {
                success: true,
                message: `⌛ Iniciando pausa...`,
            };
        } catch (error) {
            console.error('[LaborHandler] Break start error:', error);
            return {
                success: false,
                message: '❌ Error al iniciar pausa. Por favor intenta de nuevo.',
            };
        }
    }

    /**
     * Handle break end command
     */
    async handleBreakEnd(
        userId: string, 
        sessionId: string, 
        phoneNumber: string,
        geolocation?: GeolocationData
    ): Promise<LaborCommandResult> {
        try {
            await inngest.send({
                name: "shift/break.end.requested",
                data: { userId, phoneNumber, geolocation },
            });

            return {
                success: true,
                message: `⌛ Finalizando pausa...`,
            };
        } catch (error) {
            console.error('[LaborHandler] Break end error:', error);
            return {
                success: false,
                message: '❌ Error al terminar pausa. Por favor intenta de nuevo.',
            };
        }
    }

    /**
     * Handle status command
     */
    async handleStatus(userId: string, sessionId: string, phoneNumber: string): Promise<LaborCommandResult> {
        try {
            // Find active session
            const activeSession = await db.query.shiftSessions.findFirst({
                where: and(
                    eq(shiftSessions.userId, userId),
                    eq(shiftSessions.status, 'ACTIVE')
                ),
            });

            if (!activeSession) {
                return {
                    success: true,
                    message: `📊 *Estado Actual*

⚠️ No tienes una sesión activa.

Para registrar entrada, envía: *entrada*`,
                };
            }

            // Calculate current work time
            const now = new Date();
            const totalMinutes = Math.floor((now.getTime() - activeSession.startedAt.getTime()) / 60000);
            const workMinutes = totalMinutes - (activeSession.totalBreakMinutes || 0);
            const workHours = Math.floor(workMinutes / 60);
            const workMins = workMinutes % 60;

            // Check if on break
            const activeBreak = await db.query.breakLogs.findFirst({
                where: and(
                    eq(breakLogs.sessionId, activeSession.id),
                    sql`${breakLogs.endTime} IS NULL`
                ),
            });

            let message = `📊 *Estado Actual*

⏰ Entrada: ${this.formatTime(activeSession.startedAt)}
⏱️ Tiempo trabajado: ${workHours}h ${workMins}m
☕ Pausas totales: ${Math.floor((activeSession.totalBreakMinutes || 0) / 60)}h ${(activeSession.totalBreakMinutes || 0) % 60}m`;

            if (activeBreak) {
                const breakMinutes = Math.floor((now.getTime() - activeBreak.startTime.getTime()) / 60000);
                message += `\n\n⏸️ *En pausa* desde ${this.formatTime(activeBreak.startTime)} (${breakMinutes} min)`;
            }

            return {
                success: true,
                message,
            };
        } catch (error) {
            console.error('[LaborHandler] Status error:', error);
            return {
                success: false,
                message: '❌ Error al obtener estado. Por favor intenta de nuevo.',
            };
        }
    }

    /**
     * Format time as HH:MM
     */
    private formatTime(date: Date): string {
        return date.toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    }
}

// Singleton instance
export const laborHandler = new LaborHandler();
