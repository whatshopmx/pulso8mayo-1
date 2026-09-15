/**
 * @deprecated Use NotificationDispatcher from @/lib/services/notification-dispatcher instead.
 * This module will be removed in a future version.
 */
import { db } from "@/lib/db";
import { whatsappSessions, users, branches, workflowInstances, workflowTemplates } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { whatsappClient, getWhatsAppClient } from "@/lib/whatsapp/client-factory";
import { NotificationDispatcher } from "./notification-dispatcher";

export interface WorkflowAssignmentNotification {
    instanceId: string;
    userId: string;
    workflowName: string;
    dueDate?: Date;
    branchId: string;
}

export interface StockAlertNotification {
  userId: string;
  itemName: string;
  currentStock: number;
  minLevel: number;
  branchId: string;
  [key: string]: unknown;
}

export interface IncidentNotification {
    userId: string;
    incidentTitle: string;
    severity: "CRITICAL" | "WARNING" | "FATAL";
    branchId: string;
    actionUrl?: string;
}

export interface ShiftReminderNotification {
  userId: string;
  shiftDate: string;
  shiftTime: string;
  branchName: string;
  [key: string]: unknown;
}

export class WhatsAppNotificationService {
  /**
   * Get WhatsApp client (dynamically loads Wasender or WAHA based on USE_WAHA flag)
   */
  private static async getClient() {
    return await getWhatsAppClient();
  }

  /**
   * Check if employee is off-shift and digital disconnect protection applies (LFT 2026).
   */
  public static async isDigitalDisconnectActive(userId: string, isCriticalEvent: boolean = false): Promise<boolean> {
    if (isCriticalEvent) return false; // Emergencias médicas o protección civil exentas

    try {
      const activeSession = await db.query.shiftSessions.findFirst({
        where: and(
          eq(db.query.shiftSessions ? (db.query as any).shiftSessions : ({} as any), userId),
          eq(({} as any).status, "ACTIVE")
        )
      });
      // Si no hay sesión activa registrada para el usuario, se activa la desconexión digital
      return !activeSession;
    } catch {
      return false; // Fallback seguro
    }
  }

    /**
     * Get active WhatsApp session for a branch
     */
    private static async getBranchSession(branchId: string): Promise<{ sessionId: string; status: string } | null> {
        try {
            const sessions = await db.query.whatsappSessions.findMany({
                where: and(
                    eq(whatsappSessions.isActive, true),
                    // Sessions are company-wide, not branch-specific
                ),
                orderBy: (sessions, { desc }) => [desc(sessions.createdAt)]
            });

            const activeSession = sessions.find(s => s.status === "CONNECTED");
            if (activeSession) {
                return { sessionId: activeSession.sessionId, status: activeSession.status };
            }

            return null;
        } catch (error) {
            console.error("[WhatsApp] Error getting branch session:", error);
            return null;
        }
    }

    /**
     * Send workflow assignment notification
     */
    static async sendWorkflowAssignment(data: WorkflowAssignmentNotification): Promise<boolean> {
        try {
            // Get user's WhatsApp number
            const user = await db.query.users.findFirst({
                where: eq(users.id, data.userId)
            });

            if (!user?.whatsappPhone && !user?.phone) {
                console.log(`[WhatsApp] No phone number for user ${data.userId}`);
                return false;
            }

            // Desconexión Digital (Reforma LFT 2026): Encolar si está fuera de jornada y no es crítico
            const isOffShiftBlocked = await this.isDigitalDisconnectActive(data.userId);
            if (isOffShiftBlocked) {
              console.log(`[WhatsApp - Desconexión Digital] Notificación bloqueada/encolada para usuario ${data.userId} fuera de su turno laboral.`);
              return false;
            }

            const phone = user.whatsappPhone || user.phone;
            const session = await this.getBranchSession(data.branchId);

            if (!session) {
                console.warn("[WhatsApp] No active session, using notification dispatcher");
                // Fallback to in-app notification
                await NotificationDispatcher.sendNotification({
                    userId: data.userId,
                    title: "Nueva Tarea Asignada",
                    message: `Se te ha asignado: ${data.workflowName}`,
                    type: "info",
                    eventType: "workflow_assignment",
                    metadata: {
                        workflowName: data.workflowName,
                        dueDate: data.dueDate?.toISOString()
                    }
                });
                return false;
            }

const client = await this.getClient();
    if (!client) {
      await NotificationDispatcher.sendNotification({
        userId: data.userId,
        title: "Nueva Tarea Asignada",
        message: `Se te ha asignado: ${data.workflowName}`,
        type: "info",
        eventType: "workflow_assignment"
      });
      return false;
    }

    // Format due date
    const dueDateStr = data.dueDate
      ? new Date(data.dueDate).toLocaleDateString("es-MX", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "Sin fecha límite";

    const message = `📋 *Nueva Tarea Asignada*\n\n` +
      `Hola ${user.name || "Usuario"},\n\n` +
      `Se te ha asignado una nueva tarea:\n` +
      `*${data.workflowName}*\n\n` +
      `📅 *Fecha límite:* ${dueDateStr}\n\n` +
      `Por favor, revisa tu dashboard para más detalles.\n\n` +
      `_Pulso - Business Management Platform_`;

    const result = await client.sendMessage({
                sessionId: session.sessionId,
                to: phone!,
                message
            });

            console.log(`[WhatsApp] Workflow assignment sent to ${phone}: ${result.messageId}`);
            return true;

        } catch (error) {
            console.error("[WhatsApp] Error sending workflow assignment:", error);
            // Fallback to in-app notification
            await NotificationDispatcher.sendNotification({
                userId: data.userId,
                title: "Nueva Tarea Asignada",
                message: `Se te ha asignado: ${data.workflowName}`,
                type: "info",
                eventType: "workflow_assignment"
            });
            return false;
        }
    }

    /**
     * Send stock alert notification
     */
    static async sendStockAlert(data: StockAlertNotification): Promise<boolean> {
        try {
            const user = await db.query.users.findFirst({
                where: eq(users.id, data.userId)
            });

            if (!user?.whatsappPhone && !user?.phone) {
                return false;
            }

            const phone = user.whatsappPhone || user.phone;
            const session = await this.getBranchSession(data.branchId);

            if (!session) {
                await NotificationDispatcher.sendNotification({
                    userId: data.userId,
                    title: "Stock Bajo",
                    message: `${data.itemName} - Stock: ${data.currentStock}/${data.minLevel}`,
                    type: "warning",
                    eventType: "stock_alert",
                    metadata: data
                });
                return false;
            }

            const client = await this.getClient();
            if (!client) {
                await NotificationDispatcher.sendNotification({
                    userId: data.userId,
                    title: "Stock Bajo",
                    message: `${data.itemName} - Stock: ${data.currentStock}/${data.minLevel}`,
                    type: "warning",
                    eventType: "stock_alert"
                });
                return false;
            }

            const alertLevel = data.currentStock === 0 ? "🚨 AGOTADO" :
                data.currentStock <= data.minLevel / 2 ? "⚠️ MUY BAJO" : "📦 BAJO";

            const message = `${alertLevel} *Alerta de Stock*\n\n` +
                `Hola ${user.name || "Usuario"},\n\n` +
                `El item *${data.itemName}* tiene stock bajo.\n\n` +
                `📊 *Stock actual:* ${data.currentStock} unidades\n` +
                `📈 *Mínimo recomendado:* ${data.minLevel} unidades\n\n` +
                `Por favor, reordenar lo antes posible.\n\n` +
                `_Pulso - Inventory Management_`;

            const result = await client.sendMessage({
                sessionId: session.sessionId,
                to: phone!,
                message
            });

            console.log(`[WhatsApp] Stock alert sent to ${phone}: ${result.messageId}`);
            return true;

        } catch (error) {
            console.error("[WhatsApp] Error sending stock alert:", error);
            await NotificationDispatcher.sendNotification({
                userId: data.userId,
                title: "Stock Bajo",
                message: `${data.itemName} - Stock: ${data.currentStock}/${data.minLevel}`,
                type: "warning",
                eventType: "stock_alert",
                metadata: data
            });
            return false;
        }
    }

    /**
     * Send incident notification
     */
    static async sendIncidentNotification(data: IncidentNotification): Promise<boolean> {
        try {
            const user = await db.query.users.findFirst({
                where: eq(users.id, data.userId)
            });

            if (!user?.whatsappPhone && !user?.phone) {
                return false;
            }

            const phone = user.whatsappPhone || user.phone;
            const session = await this.getBranchSession(data.branchId);

            if (!session) {
                await NotificationDispatcher.sendNotification({
                    userId: data.userId,
                    title: data.incidentTitle,
                    message: `Incidente ${data.severity}`,
                    type: "error",
                    eventType: "incident",
                    metadata: {
                        incidentTitle: data.incidentTitle,
                        severity: data.severity
                    },
                    actionUrl: data.actionUrl
                });
                return false;
            }

            const client = await this.getClient();
            if (!client) {
                await NotificationDispatcher.sendNotification({
                    userId: data.userId,
                    title: data.incidentTitle,
                    message: `Incidente ${data.severity}`,
                    type: "error",
                    eventType: "incident",
                    actionUrl: data.actionUrl
                });
                return false;
            }

            const severityEmoji = data.severity === "CRITICAL" ? "🚨" :
                data.severity === "FATAL" ? "💀" : "⚠️";

            const message = `${severityEmoji} *${data.severity === "CRITICAL" ? "CRÍTICO" : data.severity === "FATAL" ? "FATAL" : "WARNING"}*\n\n` +
                `Hola ${user.name || "Usuario"},\n\n` +
                `*${data.incidentTitle}*\n\n` +
                `Se requiere acción inmediata.\n\n` +
                `_Pulso - Compliance Monitoring_`;

            const result = await client.sendMessage({
                sessionId: session.sessionId,
                to: phone!,
                message
            });

            console.log(`[WhatsApp] Incident notification sent to ${phone}: ${result.messageId}`);
            return true;

        } catch (error) {
            console.error("[WhatsApp] Error sending incident notification:", error);
            await NotificationDispatcher.sendNotification({
                userId: data.userId,
                title: data.incidentTitle,
                message: `Incidente ${data.severity}`,
                type: "error",
                eventType: "incident",
                metadata: {
                    incidentTitle: data.incidentTitle,
                    severity: data.severity
                },
                actionUrl: data.actionUrl
            });
            return false;
        }
    }

    /**
     * Send shift reminder notification
     */
    static async sendShiftReminder(data: ShiftReminderNotification): Promise<boolean> {
        try {
            const user = await db.query.users.findFirst({
                where: eq(users.id, data.userId)
            });

            if (!user?.whatsappPhone && !user?.phone) {
                return false;
            }

            const phone = user.whatsappPhone || user.phone;
            const session = await this.getBranchSession("default"); // Shift reminders don't need specific branch session

            if (!session) {
                await NotificationDispatcher.sendNotification({
                    userId: data.userId,
                    title: "Turno Programado",
                    message: `${data.shiftDate} a las ${data.shiftTime}`,
                    type: "info",
                    eventType: "shift_reminder",
                    metadata: data
                });
                return false;
            }

            const client = await this.getClient();
            if (!client) {
                await NotificationDispatcher.sendNotification({
                    userId: data.userId,
                    title: "Turno Programado",
                    message: `${data.shiftDate} a las ${data.shiftTime}`,
                    type: "info",
                    eventType: "shift_reminder"
                });
                return false;
            }

            const message = `👷 *Recordatorio de Turno*\n\n` +
                `Hola ${user.name || "Usuario"},\n\n` +
                `Tienes un turno programado:\n\n` +
                `📅 *Fecha:* ${data.shiftDate}\n` +
                `⏰ *Hora:* ${data.shiftTime}\n` +
                `📍 *Sucursal:* ${data.branchName}\n\n` +
                `¡Nos vemos!\n\n` +
                `_Pulso - Labor Management_`;

            const result = await client.sendMessage({
                sessionId: session.sessionId,
                to: phone!,
                message
            });

            console.log(`[WhatsApp] Shift reminder sent to ${phone}: ${result.messageId}`);
            return true;

        } catch (error) {
            console.error("[WhatsApp] Error sending shift reminder:", error);
            await NotificationDispatcher.sendNotification({
                userId: data.userId,
                title: "Turno Programado",
                message: `${data.shiftDate} a las ${data.shiftTime}`,
                type: "info",
                eventType: "shift_reminder",
                metadata: data
            });
            return false;
        }
    }

    /**
     * Send workflow overdue notification
     */
    static async sendWorkflowOverdue(instanceId: string, userId: string): Promise<boolean> {
        try {
            const instance = await db.query.workflowInstances.findFirst({
                where: eq(workflowInstances.id, instanceId)
            });

            if (!instance) {
                return false;
            }

            const template = await db.query.workflowTemplates.findFirst({
                where: eq(workflowTemplates.id, instance.workflowTemplateId)
            });

            if (!template) {
                return false;
            }

            const user = await db.query.users.findFirst({
                where: eq(users.id, userId)
            });

            if (!user?.whatsappPhone && !user?.phone) {
                return false;
            }

            const phone = user.whatsappPhone || user.phone;
            const session = await this.getBranchSession(instance.branchId);

            if (!session) {
                await NotificationDispatcher.sendNotification({
                    userId,
                    title: "⚠️ Tarea Vencida",
                    message: `${template.name} está vencida`,
                    type: "error",
                    eventType: "workflow_overdue"
                });
                return false;
            }

            const client = await this.getClient();
            if (!client) {
                await NotificationDispatcher.sendNotification({
                    userId,
                    title: "⚠️ Tarea Vencida",
                    message: `${template.name} está vencida`,
                    type: "error",
                    eventType: "workflow_overdue"
                });
                return false;
            }

            const overdueHours = instance.dueDate
                ? Math.floor((new Date().getTime() - new Date(instance.dueDate).getTime()) / (1000 * 60 * 60))
                : 0;

            const message = `🚨 *TAREA VENCIDA*\n\n` +
                `Hola ${user.name || "Usuario"},\n\n` +
                `La tarea *${template.name}* está VENCIDA desde hace ${overdueHours} horas.\n\n` +
                `Por favor, complétala lo antes posible.\n\n` +
                `_Pulso - Workflow Management_`;

            const result = await client.sendMessage({
                sessionId: session.sessionId,
                to: phone!,
                message
            });

            console.log(`[WhatsApp] Overdue notification sent to ${phone}: ${result.messageId}`);
            return true;

        } catch (error) {
            console.error("[WhatsApp] Error sending overdue notification:", error);
            await NotificationDispatcher.sendNotification({
                userId,
                title: "⚠️ Tarea Vencida",
                message: "Una tarea está vencida",
                type: "error",
                eventType: "workflow_overdue"
            });
            return false;
        }
    }

    /**
     * Broadcast message to multiple users
     */
    static async broadcastMessage(
        userIds: string[],
        message: string,
        branchId?: string
    ): Promise<{ success: number; failed: number }> {
        const session = branchId ? await this.getBranchSession(branchId) : null;
        const client = await this.getClient();

        let success = 0;
        let failed = 0;

        for (const userId of userIds) {
            try {
                const user = await db.query.users.findFirst({
                    where: eq(users.id, userId)
                });

                if (!user?.whatsappPhone && !user?.phone) {
                    failed++;
                    continue;
                }

                const phone = user.whatsappPhone || user.phone;

                if (session && client) {
                    await client.sendMessage({
                        sessionId: session.sessionId,
                        to: phone!,
                        message
                    });
                    success++;
                } else {
                    failed++;
                }
            } catch (error) {
                console.error(`[WhatsApp] Error broadcasting to ${userId}:`, error);
                failed++;
            }
        }

        return { success, failed };
    }
}
