import { db } from '@/lib/db';
import { incidents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export interface EscalationLevel {
    afterMinutes: number;
    triggerAfterMinutes?: number;
    level?: number;
    triggerCondition?: string;
    notifyRoles?: string[];
    message?: string;
    channel?: string;
    role?: string;
    userId?: string;
    notificationTemplate?: string;
    action?: string;
}

export interface IncidentData {
  id: string;
  title: string;
  severity?: string;
  status?: string;
  companyId?: string;
  branchId?: string;
  userId?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * EscalationService - Manages incident escalation chains
 * 
 * Responsibilities:
 * - Schedule escalation levels with delays
 * - Send notifications to appropriate roles
 * - Track escalation history
 * - Cancel escalations when incidents are resolved
 */

// In-memory store for scheduled escalations
// In production, use a proper job queue like BullMQ or pg-boss
const scheduledEscalations = new Map<string, NodeJS.Timeout[]>();

export class EscalationService {
    /**
     * Triggers an escalation chain for an incident
     * 
     * @param incident - The incident to escalate
     * @param chain - Escalation chain configuration from logicRule
     */
    static async triggerEscalation(incident: IncidentData, chain: EscalationLevel[]) {
        try {
            console.log(`[EscalationService] Triggering escalation for incident ${incident.id}`);

            if (!Array.isArray(chain) || chain.length === 0) {
                console.log('[EscalationService] No escalation chain provided');
                return;
            }

            // Cancel any existing escalations for this incident
            await this.cancelEscalation(incident.id);

            const timeouts: NodeJS.Timeout[] = [];

            // Schedule each level
            for (const level of chain) {
                const delayMs = (level.triggerAfterMinutes || 0) * 60 * 1000;

                const timeout = setTimeout(async () => {
                    await this.executeEscalationLevel(incident.id, level);
                }, delayMs);

                timeouts.push(timeout);
            }

            // Store timeouts for potential cancellation
            scheduledEscalations.set(incident.id, timeouts);

            console.log(`[EscalationService] Scheduled ${chain.length} escalation level(s)`);
        } catch (error) {
            console.error('[EscalationService] Error triggering escalation:', error);
        }
    }

    /**
     * Executes a single escalation level
     * Public for Workflow Engine usage
     */
    public static async executeEscalationLevel(incidentId: string, level: EscalationLevel) {
        try {
            console.log(`[EscalationService] Executing escalation level ${level.level} for incident ${incidentId}`);

            // Get current incident status
            const [incident] = await db
                .select()
                .from(incidents)
                .where(eq(incidents.id, incidentId))
                .limit(1);

            if (!incident) {
                console.log('[EscalationService] Incident not found, skipping escalation');
                return;
            }

            // Don't escalate if already resolved
            if (incident.status === 'RESOLVED') {
                console.log('[EscalationService] Incident already resolved, skipping escalation');
                return;
            }

            // Check trigger condition if specified
            if (level.triggerCondition) {
                const shouldTrigger = this.evaluateTriggerCondition(
                    level.triggerCondition,
                    incident
                );
                if (!shouldTrigger) {
                    console.log('[EscalationService] Trigger condition not met, skipping level');
                    return;
                }
            }

            // Send notifications to roles
            if (level.notifyRoles && Array.isArray(level.notifyRoles)) {
                await this.notifyRoles(
                    incident.branchId,
                    level.notifyRoles,
                    await this.buildLevelMessage(level, incident),
                    level.channel || 'whatsapp'
                );
            }

            // Update incident status
            await db
                .update(incidents)
                .set({
                    status: 'ESCALATED',
                    metadata: {
                        ...(incident.metadata as any),
                        lastEscalationLevel: level.level,
                        lastEscalationAt: new Date().toISOString(),
                    },
                })
                .where(eq(incidents.id, incidentId));

            console.log(`[EscalationService] Escalation level ${level.level} executed successfully`);
        } catch (error) {
            console.error('[EscalationService] Error executing escalation level:', error);
        }
    }

    /**
     * Evaluates a trigger condition for escalation
     */
    private static evaluateTriggerCondition(condition: string, incident: IncidentData): boolean {
        try {
            // Handle common trigger conditions
            if (condition === 'remediation_failed') {
                const metadata = incident.metadata as any;
                return metadata?.remediationAttempts >= metadata?.remediationMaxAttempts;
            }

            if (condition === 'not_resolved_after_time') {
                // Check if incident is still not resolved after certain time
                return incident.status !== 'RESOLVED';
            }

            // Default: trigger if not resolved
            return incident.status !== 'RESOLVED';
        } catch (error) {
            console.error('[EscalationService] Error evaluating trigger condition:', error);
            return false;
        }
    }

    /**
     * Sends notifications to users with specified roles
     */
    static async notifyRoles(
        branchId: string,
        roles: string[],
        message: string,
        channel: string = 'whatsapp'
    ) {
        try {
            console.log(`[EscalationService] Notifying roles: ${roles.join(', ')}`);

            // Get users with these roles in the branch
            const { users, branches } = await import('@/lib/db/schema');
            const { inArray, and, or, eq, isNull } = await import('drizzle-orm');

            const [branch] = await db
                .select({ companyId: branches.companyId })
                .from(branches)
                .where(eq(branches.id, branchId))
                .limit(1);

            if (!branch?.companyId) {
                console.warn(`[EscalationService] Sucursal ${branchId} sin empresa; no se notifica`);
                return;
            }

            // Alcance: la empresa dueña de la sucursal. Se incluyen los usuarios
            // sin sucursal asignada (roles corporativos como ADMIN) y se excluyen
            // los de otras sucursales para no filtrar el aviso a otro tenant.
            const usersToNotify = await db
                .select()
                .from(users)
                .where(and(
                    inArray(users.role, roles as any[]),
                    eq(users.companyId, branch.companyId),
                    or(eq(users.branchId, branchId), isNull(users.branchId)),
                    isNull(users.deletedAt)
                ));

            if (usersToNotify.length === 0) {
                console.log('[EscalationService] No users found with specified roles');
                return;
            }

            // Send notifications via NotificationService
            // For now, we'll log the notifications
            // Send notifications via WhatsAppService directly for now
            // In production, integrate with actual NotificationService
            const { WhatsAppService } = await import('@/lib/services/whatsapp-service');

            for (const user of usersToNotify) {
                if (channel === 'whatsapp' && user.phone) {
                    console.log(`[EscalationService] Sending whatsapp to ${user.phone}:`, message);
                    try {
                        await WhatsAppService.sendMessage(user.phone, message);
                    } catch (err) {
                        console.error(`[EscalationService] Failed to send whatsapp to ${user.email}`, err);
                    }
                } else {
                    console.log(`[EscalationService] Skipped ${channel} notification for ${user.email} (No phone or wrong channel)`);
                }

                // Keep the TODO for future NotificationService integration
                // const { NotificationService } = await import('./notification-service');
                // await NotificationService.sendNotification(user.id, message, channel);
            }
        } catch (error) {
            console.error('[EscalationService] Error notifying roles:', error);
        }
    }

    /**
     * Formats an escalation message with incident context
     */
    /**
     * Texto del aviso de un nivel de escalacion.
     *
     * `formatMessage` asume un `template` string y hace `template.replace`; los
     * niveles sin `message` en la cadena de escalacion llegaban con `undefined`
     * y reventaban la escalacion entera dentro del `catch` de arriba, que la
     * tragaba en silencio: nadie recibia el aviso y nada lo delataba salvo un
     * log. Cuando el nivel no trae texto propio se usa la plantilla de
     * escalacion, que es justamente para lo que se escribio.
     */
    private static async buildLevelMessage(
        level: EscalationLevel,
        incident: IncidentData
    ): Promise<string> {
        if (level.message) {
            return this.formatMessage(level.message, incident);
        }

        const { renderIncidentTemplate } = await import(
            '@/lib/whatsapp/templates/incident-templates'
        );
        const { IncidentEngine } = await import('./incident-engine');

        const vars = await IncidentEngine.buildTemplateVars({
            title: incident.title,
            severity: incident.severity ?? 'WARNING',
            branchId: incident.branchId as string,
            createdAt: (incident.createdAt as Date) ?? new Date(),
            resolution: null,
            resolvedAt: null,
        } as any);

        return renderIncidentTemplate('escalation', vars).whatsapp;
    }

    private static formatMessage(template: string, incident: IncidentData): string {
        let message = template;

        // Replace placeholders
        const metadata = incident.metadata as any;

        message = message.replace(/{incident_id}/g, incident.id);
        message = message.replace(/{severity}/g, incident.severity);
        message = message.replace(/{title}/g, incident.title);
        message = message.replace(/{value}/g, metadata?.value || 'N/A');
        message = message.replace(/{employee_name}/g, metadata?.employeeName || 'Unknown');
        message = message.replace(/{ai_result\.detectedIssues}/g, metadata?.aiResult?.detectedIssues || 'N/A');
        message = message.replace(/{ai_result\.analysis}/g, metadata?.aiResult?.reason || 'N/A');

        return message;
    }

    /**
     * Cancels all pending escalations for an incident
     */
    static async cancelEscalation(incidentId: string) {
        try {
            const timeouts = scheduledEscalations.get(incidentId);

            if (timeouts) {
                timeouts.forEach(timeout => clearTimeout(timeout));
                scheduledEscalations.delete(incidentId);
                console.log(`[EscalationService] Cancelled escalations for incident ${incidentId}`);
            }
        } catch (error) {
            console.error('[EscalationService] Error cancelling escalation:', error);
        }
    }

    /**
     * Manually escalate an incident to the next level
     */
    static async manualEscalate(
        incidentId: string,
        targetLevel: number,
        escalatedBy: string
    ) {
        try {
            const [incident] = await db
                .select()
                .from(incidents)
                .where(eq(incidents.id, incidentId))
                .limit(1);

            if (!incident) {
                throw new Error('Incident not found');
            }

            const escalationChain = incident.escalationChain as any[];
            if (!escalationChain || !Array.isArray(escalationChain)) {
                throw new Error('No escalation chain configured');
            }

            const level = escalationChain.find(l => l.level === targetLevel);
            if (!level) {
                throw new Error(`Escalation level ${targetLevel} not found`);
            }

            // Execute the level immediately
            await this.executeEscalationLevel(incidentId, level);

            // Log manual escalation
            await db
                .update(incidents)
                .set({
                    metadata: {
                        ...(incident.metadata as any),
                        manualEscalation: {
                            level: targetLevel,
                            by: escalatedBy,
                            at: new Date().toISOString(),
                        },
                    },
                })
                .where(eq(incidents.id, incidentId));

            console.log(`[EscalationService] Manual escalation to level ${targetLevel} completed`);
        } catch (error) {
            console.error('[EscalationService] Error in manual escalation:', error);
            throw error;
        }
    }
}
