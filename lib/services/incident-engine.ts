import { db } from '@/lib/db';
import { incidents, workflowInstanceSteps, workflowInstances } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export interface LogicRule {
    id?: string;
    condition: string;
    severity?: string;
    action?: string;
    actions?: string[];
    description?: string;
    remediationStepId?: string;
    message?: string;
    remediationProtocol?: unknown;
    escalationChain?: unknown;
}

export interface WorkflowStep {
    id: string;
    type?: string;
    title?: string;
    logicRules?: LogicRule[];
    [key: string]: unknown;
}

export interface EvaluationContext {
    value?: unknown;
    ai_result?: Record<string, unknown>;
    gps_validation?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface AICheckResult {
    passed?: boolean;
    confidence?: number;
    notes?: string;
    [key: string]: unknown;
}

/**
 * IncidentEngine - Evaluates logicRules from workflow templates and creates incidents
 * 
 * Responsibilities:
 * - Evaluate condition expressions from logicRules
 * - Create incidents when conditions are met
 * - Trigger escalation chains
 * - Trigger remediation protocols
 */
export class IncidentEngine {
    /**
     * Evaluates a single logicRule condition
     * 
     * @param condition - Condition string (e.g., "value > 26", "ai_result.passed == false")
     * @param context - Context object with variables (value, ai_result, gps_validation, etc.)
     * @returns boolean - Whether condition is met
     */
    static evaluateCondition(condition: string, context: Record<string, any>): boolean {
        try {
            // Create a safe evaluation context
            const safeContext = {
                value: context.value,
                ai_result: context.ai_result || {},
                gps_validation: context.gps_validation || {},
                // Add more context variables as needed
            };

            // Replace context variables in condition
            let evaluableCondition = condition;

            // Handle ai_result.passed
            if (condition.includes('ai_result.passed')) {
                evaluableCondition = evaluableCondition.replace(
                    /ai_result\.passed/g,
                    String(safeContext.ai_result.passed || false)
                );
            }

            // Handle ai_result.confidence
            if (condition.includes('ai_result.confidence')) {
                evaluableCondition = evaluableCondition.replace(
                    /ai_result\.confidence/g,
                    String(safeContext.ai_result.confidence || 0)
                );
            }

            // Handle gps_validation.withinRadius
            if (condition.includes('gps_validation.withinRadius')) {
                evaluableCondition = evaluableCondition.replace(
                    /gps_validation\.withinRadius/g,
                    String(safeContext.gps_validation.withinRadius || false)
                );
            }

            // Handle value comparisons
            if (condition.includes('value')) {
                const value = safeContext.value;

                // Handle string includes
                if (condition.includes('.includes(')) {
                    const match = condition.match(/value\.includes\(['"](.+?)['"]\)/);
                    if (match && typeof value === 'string') {
                        return value.toLowerCase().includes(match[1].toLowerCase());
                    }
                }

                // Handle numeric comparisons
                if (typeof value === 'number' || !isNaN(Number(value))) {
                    evaluableCondition = evaluableCondition.replace(/value/g, String(value));
                } else if (typeof value === 'string') {
                    evaluableCondition = evaluableCondition.replace(/value/g, `"${value}"`);
                }
            }

            // Safe evaluation using Function constructor (limited scope)
            // This is safer than eval() but still requires careful input validation
            const result = new Function(`return ${evaluableCondition}`)();
            return Boolean(result);
        } catch (error) {
            console.error('[IncidentEngine] Error evaluating condition:', condition, error);
            return false;
        }
    }

    /**
     * Evaluates all logicRules for a step and returns matched rules
     * 
     * @param step - Step configuration from template
     * @param value - User's submitted value
     * @param aiResult - AI verification result (if applicable)
     * @param context - Additional context
     * @returns Array of matched rules
     */
    static evaluateLogicRules(
        step: WorkflowStep,
        value: unknown,
        aiResult?: AICheckResult,
        context?: Record<string, unknown>
    ): LogicRule[] {
        if (!step.logicRules || !Array.isArray(step.logicRules)) {
            return [];
        }

        const evaluationContext = {
            value,
            ai_result: aiResult,
            ...context,
        };

        const matchedRules = step.logicRules?.filter((rule: LogicRule) => {
            if (!rule.condition) return false;
            return this.evaluateCondition(rule.condition, evaluationContext);
        });

        return matchedRules;
    }

    /**
     * Creates an incident from a matched logicRule
     * 
     * @param instanceId - Workflow instance ID
     * @param stepId - Step ID that triggered the incident
     * @param rule - The matched logicRule
     * @param context - Additional context (value, aiResult, etc.)
     * @returns Created incident
     */
    static async createIncident(
        instanceId: string,
        stepId: string,
        rule: LogicRule,
        context: {
            value?: unknown;
            aiResult?: AICheckResult;
            userId?: string;
            branchId?: string;
        }
    ) {
        try {
            // Get workflow instance details
            const [instance] = await db
                .select()
                .from(workflowInstances)
                .where(eq(workflowInstances.id, instanceId))
                .limit(1);

            if (!instance) {
                throw new Error(`Workflow instance ${instanceId} not found`);
            }

    // Prepare incident data
    // Validate severity is one of the enum values
    const validSeverities = ['CRITICAL', 'WARNING', 'FATAL'] as const;
    const severity = validSeverities.includes(rule.severity as any)
      ? rule.severity as 'CRITICAL' | 'WARNING' | 'FATAL'
      : 'WARNING';

    const incidentData = {
      instanceId: instanceId, // Fixed column name
      stepId: stepId,
      branchId: context.branchId || instance.branchId,
      severity,
                status: 'DETECTED' as const,
                title: rule.message || 'Incident detected',
                description: this.buildIncidentDescription(rule, context),
                detectedBy: context.userId,
                remediationProtocol: rule.remediationProtocol || null, // Pass object directly for jsonb
                escalationChain: rule.escalationChain || null, // Pass object directly for jsonb
                metadata: {
                    ruleId: rule.id,
                    stepId,
                    value: context.value,
                    aiResult: context.aiResult,
                },
            };

            // Create incident
            const [incident] = await db
                .insert(incidents)
                .values(incidentData)
                .returning();

            console.log('[IncidentEngine] Incident created:', incident.id, incident.severity, incident.title);

            // Trigger escalation if chain exists
            if (rule.escalationChain && Array.isArray(rule.escalationChain)) {
                const { inngest } = await import("@/lib/inngest/client");

                await inngest.send({
                    name: "incident/escalation.requested",
                    data: { incidentId: incident.id, chain: rule.escalationChain },
                });
            }

            // Start remediation if protocol exists
            if (rule.remediationProtocol) {
                // Import dynamically to avoid circular dependency
                const { RemediationService } = await import('./remediation-service');
                // We know this updates the DB, so we should update our local object too
                // or refetch, but updating local object is faster
                await RemediationService.startRemediationProtocol(incident);
                (incident as any).status = 'IN_REMEDIATION';
            }

            // Trigger NOM-035 / NOM-251 action plan auto-generation if action/rule specifies it or if critical
            const hasRemediationPlanAction = rule.actions && Array.isArray(rule.actions) && rule.actions.includes("CREATE_REMEDIATION_PLAN");
            if (hasRemediationPlanAction || rule.severity === 'CRITICAL') {
                try {
                    const { NOM035Service } = await import('./compliance/nom035-service');
                    await NOM035Service.createActionPlanFromWorkflow(
                        instanceId,
                        rule.id || 'system-rule',
                        rule.message || 'Desviación detectada',
                        context.userId || 'system'
                    );
                } catch (actionPlanErr) {
                    console.error('[IncidentEngine] Error auto-generating action plan:', actionPlanErr);
                }
            }

            return incident;
        } catch (error) {
            console.error('[IncidentEngine] Error creating incident:', error);
            throw error;
        }
    }

    /**
     * Builds a detailed incident description
     */
    private static buildIncidentDescription(rule: LogicRule, context: EvaluationContext): string {
        let description = rule.message || 'Incident detected';

        // Add context details
        if (context.value !== undefined) {
            description += `\n\nValue: ${context.value}`;
        }

    if (context.aiResult) {
      const aiResult = context.aiResult as Record<string, unknown>;
      description += `\n\nAI Analysis: ${aiResult.reason || 'N/A'}`;
      if (aiResult.detectedIssues) {
        description += `\nIssues: ${aiResult.detectedIssues}`;
      }
    }

        return description;
    }

    /**
     * Checks all completed steps of a workflow instance for incident conditions
     * This is called after each step completion
     * 
     * @param instanceId - Workflow instance ID
     * @param currentStepId - The step that was just completed
     * @param stepValue - The value submitted for the step
     * @param aiResult - AI verification result (if applicable)
     * @param userId - User who completed the step
     */
    static async checkIncidentConditions(
        instanceId: string,
        currentStepId: string,
        stepValue: unknown,
        aiResult?: AICheckResult,
        userId?: string
    ) {
        try {
            // Get workflow instance with template
            const [instance] = await db
                .select()
                .from(workflowInstances)
                .where(eq(workflowInstances.id, instanceId))
                .limit(1);

            if (!instance) {
                console.error('[IncidentEngine] Instance not found:', instanceId);
                return [];
            }

            // Get template to access step configuration
            // Note: In production, you'd load the template from your templates directory
            // For now, we'll assume the template is available in the instance data
            const templateSteps = (instance.data as any)?.templateSteps || [];
            const currentStep = templateSteps.find((s: WorkflowStep) => s.id === currentStepId);

            if (!currentStep) {
                console.log('[IncidentEngine] Step not found in template:', currentStepId);
                return [];
            }

            // Evaluate logicRules for this step
            const matchedRules = this.evaluateLogicRules(
                currentStep,
                stepValue,
                aiResult,
                { gps_validation: (instance.data as any)?.gps_validation }
            );

            if (matchedRules.length === 0) {
                console.log('[IncidentEngine] No rules matched for step:', currentStepId);
                return [];
            }

            console.log(`[IncidentEngine] ${matchedRules.length} rule(s) matched for step ${currentStepId}`);

            // Create incidents for matched rules
            const createdIncidents = [];
            for (const rule of matchedRules) {
                const incident = await this.createIncident(
                    instanceId,
                    currentStepId,
                    rule,
                    {
                        value: stepValue,
                        aiResult,
                        userId,
                        branchId: instance.branchId,
                    }
                );
                createdIncidents.push(incident);
            }

            return createdIncidents;
        } catch (error) {
            console.error('[IncidentEngine] Error checking incident conditions:', error);
            return [];
        }
    }

    /**
     * Gets all incidents for a workflow instance
     */
    static async getIncidents(instanceId: string) {
        return await db
            .select()
            .from(incidents)
            .where(eq(incidents.instanceId, instanceId))
            .orderBy(incidents.createdAt);
    }

    /**
     * Resolves an incident
     */
    static async resolveIncident(
        incidentId: string,
        resolution: string,
        resolvedBy: string
    ) {
        const [incident] = await db
            .update(incidents)
            .set({
                status: 'RESOLVED',
                resolvedAt: new Date(),
                resolvedBy,
                resolution,
            })
            .where(eq(incidents.id, incidentId))
            .returning();

        // Cancel any pending escalations
        if (incident) {
            const { EscalationService } = await import('./escalation-service');
            await EscalationService.cancelEscalation(incidentId);
        }

        return incident;
    }
}
