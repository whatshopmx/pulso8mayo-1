import { db } from '@/lib/db';
import { incidents, workflowInstanceSteps, workflowInstances, workflowTemplates, branches, equipmentAlerts } from '@/lib/db/schema';
import { eq, and, notInArray, sql } from 'drizzle-orm';
import {
    renderIncidentTemplate,
    type IncidentTemplateVars,
} from '@/lib/whatsapp/templates/incident-templates';

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
    /** Roles a notificar para las acciones NOTIFY* */
    notifyRoles?: string[];
    /** Tipo de servicio externo para la acción SCHEDULE_COMPLIANCE_SERVICE */
    complianceServiceType?: string;
    /** Equipo al que aplica CREATE_MAINTENANCE_TICKET, si la plantilla lo declara */
    equipmentId?: string;
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

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Respuestas de sí/no reconocidas, en minúsculas.
 *
 * Solo coincidencias exactas: una opción de lista como "No apto" o
 * "No - más de 12 meses" debe seguir siendo texto.
 */
const YES_NO_VOCABULARY: Record<string, boolean> = {
    si: true, 'sí': true, yes: true, true: true,
    no: false, false: false,
};

/**
 * Tokens prohibidos en una condición.
 *
 * Las condiciones se escriben desde el builder y se ejecutan con `new Function`
 * en el servidor: sin este filtro, quien pueda editar una plantilla ejecuta
 * código arbitrario con acceso a la base. Se bloquean las vías de escape al
 * ámbito global, la construcción dinámica de código y el acceso a prototipos.
 */
const FORBIDDEN_TOKENS = [
    'require', 'import', 'process', 'global', 'globalThis', 'eval',
    'Function', 'constructor', 'prototype', '__proto__', 'fetch',
    'async', 'await', 'yield', 'new', 'class', 'function', 'this',
    'window', 'document', 'Buffer', 'child_process', 'module', 'exports',
];

/**
 * Solo caracteres necesarios para comparaciones y lógica booleana.
 *
 * Incluye letras Unicode porque los literales de las plantillas están en
 * español ("Sí", "Sin síntomas"); lo que importa excluir son las llaves, el
 * punto y coma, la barra invertida y los backticks, que abren construcciones
 * de código en lugar de expresiones.
 */
const ALLOWED_CHARS = /^[\p{L}\p{N}_$\s.,'"()[\]!=<>+\-*/%&|?:¿¡°]+$/u;

/**
 * Valida que una condición sea una expresión de comparación inofensiva.
 * Devuelve el motivo del rechazo, o null si es aceptable.
 */
function rejectionReason(expression: string): string | null {
    if (expression.length > 500) return 'excede 500 caracteres';
    if (!ALLOWED_CHARS.test(expression)) return 'contiene caracteres no permitidos';
    if (expression.includes('`')) return 'contiene template literals';
    if (expression.includes('=>')) return 'contiene funciones flecha';
    if (/(^|[^=!<>])=([^=]|$)/.test(expression)) return 'contiene asignación';

    // Se comparan identificadores completos para no rechazar "valueNew" por "new"
    const identifiers = expression.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
    for (const token of identifiers) {
        if (FORBIDDEN_TOKENS.includes(token)) return `usa el token prohibido "${token}"`;
    }

    return null;
}

/** Convierte un texto libre en identificador snake_case sin acentos. */
function toSnakeCase(text: string): string {
    return text
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

/**
 * ¿La BD ya conoce la severidad HIGH?
 *
 * La migración que la agrega (0042) puede no estar aplicada todavía —en este
 * repo el journal y la BD se desincronizan—, y un insert con un valor de enum
 * inexistente aborta la creación del incidente completo. Se consulta una vez
 * por proceso y, si falta, se degrada a WARNING como antes.
 */
let highSeveritySupported: boolean | null = null;

async function supportsHighSeverity(): Promise<boolean> {
    if (highSeveritySupported !== null) return highSeveritySupported;

    try {
        const result = await db.execute(sql`
            select 1 from pg_type t
            join pg_enum e on e.enumtypid = t.oid
            where t.typname = 'incident_severity' and e.enumlabel = 'HIGH'
            limit 1
        `);
        const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
        highSeveritySupported = Array.isArray(rows) && rows.length > 0;

        if (!highSeveritySupported) {
            console.warn(
                '[IncidentEngine] La severidad HIGH no existe en la base: aplica la migración 0042 ' +
                '(npm run db:migrate). Hasta entonces las reglas HIGH se registran como WARNING.'
            );
        }
    } catch (error) {
        console.error('[IncidentEngine] No se pudo verificar el enum de severidad:', error);
        highSeveritySupported = false;
    }

    return highSeveritySupported;
}

/** Variante camelCase del mismo texto, para plantillas que nombran así sus campos. */
function toCamelCase(text: string): string {
    const parts = toSnakeCase(text).split('_').filter(Boolean);
    if (parts.length === 0) return '';
    return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
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
        if (typeof condition !== 'string' || condition.trim() === '') return false;

        const expression = condition.trim();
        if (expression === 'true') return true;
        if (expression === 'false') return false;

        const rejection = rejectionReason(expression);
        if (rejection) {
            console.error(
                `[IncidentEngine] Condición rechazada por seguridad: "${expression}" — ${rejection}`
            );
            return false;
        }

        const scope = this.buildEvaluationScope(context);
        // Los nombres pasados a `new Function` deben ser identificadores válidos;
        // una clave como "ai_result.passed" haría fallar toda la evaluación.
        const names = Object.keys(scope).filter(name => IDENTIFIER_PATTERN.test(name));

        try {
            const evaluate = new Function(...names, `"use strict"; return (${expression});`);
            return Boolean(evaluate(...names.map(name => scope[name])));
        } catch (error) {
            // Una condición no evaluable es un error de autoría de la plantilla, no
            // un incidente inexistente: se registra explícitamente en lugar de
            // devolver `false` en silencio.
            if (error instanceof ReferenceError) {
                console.warn(
                    `[IncidentEngine] Condición no evaluable — variable ausente del contexto: "${expression}" (${error.message}). ` +
                    `Variables disponibles: ${names.join(', ')}`
                );
            } else if (error instanceof SyntaxError) {
                console.warn(`[IncidentEngine] Condición no evaluable — sintaxis inválida: "${expression}" (${error.message})`);
            } else {
                console.error('[IncidentEngine] Error evaluando condición:', expression, error);
            }
            return false;
        }
    }

    /**
     * Arma el ámbito de variables visible para una condición.
     *
     * Además del contexto recibido expone los alias derivados que usan las
     * plantillas (`ai_verification_failed`) y helpers matemáticos (`abs`),
     * porque las condiciones de la librería de plantillas los dan por hechos.
     */
    private static buildEvaluationScope(context: Record<string, unknown>): Record<string, unknown> {
        const aiResult = (context.ai_result ?? {}) as Record<string, unknown>;

        return {
            ...context,
            value: this.normalizeValue(context.value),
            ai_result: aiResult,
            gps_validation: context.gps_validation ?? {},
            ai_verification_failed: aiResult.passed === false,
            ai_verification_passed: aiResult.passed === true,
            abs: Math.abs,
            min: Math.min,
            max: Math.max,
            round: Math.round,
            Math,
            today: new Date(),
        };
    }

    /**
     * Normaliza un valor capturado en un paso.
     *
     * Los valores viven en columnas jsonb y llegan como escalares codificados
     * (`'"26"'`, `'"Sí"'`, `'true'`), así que hay que decodificarlos antes de
     * compararlos numéricamente o por igualdad.
     */
    private static normalizeValue(raw: unknown): unknown {
        if (typeof raw !== 'string') return raw;

        let value: unknown = raw.trim();

        if (typeof value === 'string') {
            const looksEncoded = (value.startsWith('"') && value.endsWith('"'))
                || value === 'true' || value === 'false' || value === 'null';
            if (looksEncoded) {
                try {
                    value = JSON.parse(value);
                } catch {
                    // Se conserva el string original si no es JSON válido
                }
            }
        }

        if (typeof value === 'string') {
            // Los pasos de sí/no se guardan como texto y sin un formato único:
            // el ejecutor escribe 'SI'/'NO', el builder ofrece 'si'/'no' y las
            // plantillas comparan contra 'no', true y 'true'. Se colapsa todo a
            // booleano para que las reglas se escriban de una sola forma.
            const answer = YES_NO_VOCABULARY[value.toLowerCase()];
            if (answer !== undefined) return answer;

            if (value !== '' && !isNaN(Number(value))) return Number(value);
        }

        return value;
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

        // El contexto extra va primero: `value` y `ai_result` del paso actual
        // siempre deben ganar frente a un alias con el mismo nombre.
        const evaluationContext = {
            ...context,
            value,
            ai_result: aiResult,
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
    const validSeverities = ['CRITICAL', 'WARNING', 'FATAL', 'HIGH'] as const;
    const declared = (rule.severity ?? '').toUpperCase();
    if (rule.severity && !validSeverities.includes(declared as typeof validSeverities[number])) {
      console.warn(
        `[IncidentEngine] Severidad "${rule.severity}" desconocida en la regla ${rule.id}; ` +
        `se registra como WARNING`
      );
    }
    let severity: typeof validSeverities[number] = validSeverities.includes(declared as typeof validSeverities[number])
      ? declared as typeof validSeverities[number]
      : 'WARNING';

    if (severity === 'HIGH' && !await supportsHighSeverity()) {
      severity = 'WARNING';
    }

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
                    // Las acciones declaradas en la regla se persisten para que
                    // el incidente sepa después qué había que hacer. Sin esto la
                    // intención del diseñador se pierde al terminar el motor, y
                    // la recomendación tiene que adivinarla desde el título.
                    actions: rule.actions ?? null,
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

            // Ejecutar las acciones declaradas por la regla (BLOCK, NOTIFY, …)
            await this.executeRuleActions(incident, rule, {
                instanceId,
                stepId,
                userId: context.userId,
            });

            // Trigger NOM-035 / NOM-251 action plan auto-generation if action/rule specifies it or if critical
            const planActions = ['CREATE_REMEDIATION_PLAN', 'GENERATE_ACTION_PLAN'];
            const hasRemediationPlanAction = Array.isArray(rule.actions)
                && rule.actions.some(a => planActions.includes(a));
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
     * Ejecuta las acciones declaradas en `rule.actions`.
     *
     * Cada acción se aísla: un fallo no impide las demás ni la creación del
     * incidente, que ya está persistido cuando esto corre.
     */
    private static async executeRuleActions(
        incident: typeof incidents.$inferSelect,
        rule: LogicRule,
        context: { instanceId: string; stepId: string; userId?: string }
    ): Promise<void> {
        if (!Array.isArray(rule.actions) || rule.actions.length === 0) return;

        for (const action of rule.actions) {
            try {
                switch (action) {
                    case 'BLOCK':
                        await this.blockWorkflowInstance(context.instanceId, incident);
                        break;

                    case 'ESCALATE':
                        // Con cadena definida, createIncident ya despachó el evento
                        // durable; sin cadena se usa el flujo por defecto, que
                        // avisa al supervisor y escala a los 30 min sin respuesta.
                        if (!Array.isArray(rule.escalationChain) || rule.escalationChain.length === 0) {
                            const { inngest } = await import('@/lib/inngest/client');
                            await inngest.send({
                                name: 'incident/detected',
                                data: { incidentId: incident.id },
                            });
                        }
                        break;

                    case 'REQUIRE_REMEDIATION':
                        await this.mergeIncidentMetadata(incident.id, { requiresRemediation: true });
                        break;

                    case 'SCHEDULE_COMPLIANCE_SERVICE': {
                        const serviceType = rule.complianceServiceType;
                        if (!serviceType) {
                            console.warn(
                                `[IncidentEngine] SCHEDULE_COMPLIANCE_SERVICE omitida en la regla ${rule.id}: ` +
                                `falta "complianceServiceType"`
                            );
                            break;
                        }
                        const { RemediationService } = await import('./remediation-service');
                        await RemediationService.handleExternalServiceStep(incident, {
                            type: 'external_service',
                            complianceServiceType: serviceType,
                            instruction: rule.message || `Coordinar servicio externo: ${serviceType}`,
                        });
                        break;
                    }

                    case 'NOTIFY':
                    case 'NOTIFY_RH':
                    case 'NOTIFY_RH_ANONYMOUS':
                        await this.notifyForAction(action, incident, rule);
                        break;

                    case 'LOG_VIOLATION':
                    case 'LOG_RETARD':
                    case 'LOG_ABSENCE':
                        await this.logLaborEvent(action, incident, rule);
                        break;

                    case 'CREATE_MAINTENANCE_TICKET':
                        await this.createMaintenanceAlert(incident, rule);
                        break;

                    // Ya resueltas fuera de este switch
                    case 'CREATE_REMEDIATION_PLAN':
                    case 'GENERATE_ACTION_PLAN':
                        break;

                    default:
                        console.warn(
                            `[IncidentEngine] Acción "${action}" declarada en la regla ${rule.id} sin ` +
                            `implementación: no existe la entidad destino en el sistema. Incidente ${incident.id}.`
                        );
                }
            } catch (error) {
                console.error(`[IncidentEngine] Error ejecutando acción "${action}":`, error);
            }
        }
    }

    /**
     * Bloquea la instancia del workflow: el checklist no puede seguir avanzando
     * mientras el incidente esté abierto.
     */
    private static async blockWorkflowInstance(
        instanceId: string,
        incident: typeof incidents.$inferSelect
    ): Promise<void> {
        // La marca vive en el incidente, no solo en la instancia: `checkProgress`
        // recalcula el estado en cada paso y necesita saber si sigue habiendo un
        // motivo de bloqueo vigente.
        await this.mergeIncidentMetadata(incident.id, { blocking: true });

        await db
            .update(workflowInstances)
            .set({ status: 'BLOCKED', updatedAt: new Date() })
            .where(eq(workflowInstances.id, instanceId));

        console.log(`[IncidentEngine] Instancia ${instanceId} bloqueada por incidente ${incident.id}`);
    }

    /**
     * Fusiona claves en el metadata del incidente con `jsonb ||`.
     *
     * No se hace con spread del objeto en memoria porque una regla puede
     * declarar varias acciones (BLOCK + REQUIRE_REMEDIATION) y la segunda
     * escribiría sobre una copia obsoleta, borrando lo que puso la primera.
     */
    private static async mergeIncidentMetadata(
        incidentId: string,
        patch: Record<string, unknown>
    ): Promise<void> {
        await db
            .update(incidents)
            .set({
                metadata: sql`COALESCE(${incidents.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
                updatedAt: new Date(),
            })
            .where(eq(incidents.id, incidentId));
    }

    /**
     * ¿Queda algún incidente sin resolver que bloquee esta instancia?
     * Solo cuentan los creados por una regla con la acción BLOCK.
     */
    static async hasBlockingIncidents(instanceId: string): Promise<boolean> {
        const rows = await db
            .select({ id: incidents.id })
            .from(incidents)
            .where(and(
                eq(incidents.instanceId, instanceId),
                notInArray(incidents.status, ['RESOLVED']),
                sql`${incidents.metadata}->>'blocking' = 'true'`
            ))
            .limit(1);

        return rows.length > 0;
    }

    /**
     * Notifica a los roles correspondientes. NOTIFY_RH_ANONYMOUS omite el valor
     * capturado y quién lo reportó, porque las reglas que la usan cubren
     * respuestas anónimas de NOM-035.
     */
    private static async notifyForAction(
        action: string,
        incident: typeof incidents.$inferSelect,
        rule: LogicRule
    ): Promise<void> {
        const { EscalationService } = await import('./escalation-service');
        const isAnonymous = action === 'NOTIFY_RH_ANONYMOUS';
        const roles = rule.notifyRoles
            ?? (action === 'NOTIFY' ? ['GERENTE'] : ['ADMIN']);

        /**
         * El aviso sale de la plantilla, no de una interpolacion suelta.
         *
         * `incident-templates.ts` existia desde el plan de incidentes V2 pero
         * nadie lo importaba: el mensaje real se seguia armando aqui a mano,
         * sin sucursal ni fecha, y el archivo era codigo muerto. La rama
         * anonima se queda como estaba porque NOM-035 pide omitir el dato
         * capturado y a quien reporto, y esa decision no es de la plantilla.
         */
        const message = isAnonymous
            ? `🔒 Reporte anónimo (${incident.severity}): ${incident.title}`
            : renderIncidentTemplate('detected', await this.buildTemplateVars(incident)).whatsapp;

        await EscalationService.notifyRoles(incident.branchId, roles, message, 'whatsapp');
    }

    /**
     * Variables de plantilla para un incidente.
     *
     * La sucursal se resuelve aqui y no dentro de la plantilla para que el
     * modulo de plantillas siga siendo puro (sin `db`) y se pueda probar sin
     * base de datos.
     */
    static async buildTemplateVars(
        incident: Pick<
            typeof incidents.$inferSelect,
            'title' | 'severity' | 'branchId' | 'createdAt' | 'resolution' | 'resolvedAt'
        >
    ): Promise<IncidentTemplateVars> {
        const [branch] = await db
            .select({ name: branches.name })
            .from(branches)
            .where(eq(branches.id, incident.branchId))
            .limit(1);

        const detectedAt = incident.createdAt ?? new Date();

        return {
            title: incident.title,
            severity: incident.severity,
            branch: branch?.name ?? 'Sucursal sin nombre',
            detectedAt: detectedAt.toLocaleString('es-MX', {
                dateStyle: 'short',
                timeStyle: 'short',
            }),
            resolution: incident.resolution ?? undefined,
            resolutionTime: incident.resolvedAt
                ? formatearDuracion(detectedAt, incident.resolvedAt)
                : undefined,
        };
    }

    /**
     * Levanta una alerta de mantenimiento.
     *
     * Se escribe en `equipment_alerts` y no en `equipment_maintenance_history`
     * porque el historial exige un `equipmentId` y las reglas de las plantillas
     * no dicen a qué equipo se refieren. La alerta admite equipo nulo, así que
     * queda visible para que mantenimiento la asigne. Si la regla declara
     * `equipmentId`, se vincula directo.
     */
    private static async createMaintenanceAlert(
        incident: typeof incidents.$inferSelect,
        rule: LogicRule
    ): Promise<void> {
        const [branch] = await db
            .select({ companyId: branches.companyId })
            .from(branches)
            .where(eq(branches.id, incident.branchId))
            .limit(1);

        if (!branch?.companyId) {
            console.warn(
                `[IncidentEngine] CREATE_MAINTENANCE_TICKET omitida: la sucursal ` +
                `${incident.branchId} no tiene empresa asociada`
            );
            return;
        }

        // La severidad de equipment_alerts es su propia escala (LOW…CRITICAL)
        const severityMap: Record<string, string> = {
            FATAL: 'CRITICAL',
            CRITICAL: 'CRITICAL',
            HIGH: 'HIGH',
            WARNING: 'MEDIUM',
        };

        const [alert] = await db
            .insert(equipmentAlerts)
            .values({
                companyId: branch.companyId,
                branchId: incident.branchId,
                equipmentId: rule.equipmentId ?? null,
                alertType: 'EQUIPMENT_FAILURE',
                severity: severityMap[incident.severity] ?? 'MEDIUM',
                title: incident.title,
                description:
                    `${incident.description ?? ''}\n\n` +
                    `Generada automáticamente por el incidente ${incident.id} ` +
                    `(regla ${rule.id ?? 'sin id'}, paso ${incident.stepId}).`,
                status: 'ACTIVE',
            })
            .returning();

        console.log(`[IncidentEngine] Alerta de mantenimiento ${alert.id} creada por incidente ${incident.id}`);
    }

    /**
     * Deja constancia auditable de un evento laboral (retardo, ausencia,
     * violación de descanso) contra el empleado que disparó el incidente.
     */
    private static async logLaborEvent(
        action: string,
        incident: typeof incidents.$inferSelect,
        rule: LogicRule
    ): Promise<void> {
        if (!incident.detectedBy) {
            console.warn(
                `[IncidentEngine] ${action} omitida en el incidente ${incident.id}: ` +
                `no hay empleado asociado (detectedBy vacío)`
            );
            return;
        }

        const { AuditService } = await import('./audit-service');
        await AuditService.logEmployeeAction({
            userId: incident.detectedBy,
            action: 'CREATE',
            entityType: action,
            entityId: incident.id,
            newValue: { ruleId: rule.id, severity: incident.severity, title: incident.title },
            performedBy: 'system',
            reason: rule.message || incident.title,
        });
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
     * Carga la definición de pasos de una instancia.
     *
     * Fuente de verdad: `workflow_templates.steps`. Si la instancia guardó sus
     * pasos resueltos en `data.templateSteps` (pasos dinámicos), esos se suman
     * y tienen prioridad para los ids que definen.
     */
    private static async loadTemplateSteps(
        instance: { workflowTemplateId: string; data: unknown }
    ): Promise<WorkflowStep[]> {
        const instanceData = (instance.data ?? {}) as Record<string, unknown>;
        const runtimeSteps = (instanceData.templateSteps ?? []) as WorkflowStep[];

        let templateSteps: WorkflowStep[] = [];
        if (instance.workflowTemplateId) {
            const template = await db.query.workflowTemplates.findFirst({
                where: eq(workflowTemplates.id, instance.workflowTemplateId),
            });
            if (template) {
                templateSteps = (template.steps ?? []) as unknown as WorkflowStep[];
            } else {
                console.warn(`[IncidentEngine] Plantilla no encontrada: ${instance.workflowTemplateId}`);
            }
        }

        if (runtimeSteps.length === 0) return templateSteps;

        const runtimeIds = new Set(runtimeSteps.map(s => s.id));
        return [...runtimeSteps, ...templateSteps.filter(s => !runtimeIds.has(s.id))];
    }

    /**
     * Expone el valor de cada paso de la instancia como variable de condición.
     *
     * Las plantillas escriben condiciones entre pasos usando el nombre del campo
     * (`severidad == 'Alta'`, `gerente_notificado == false`), no el id del paso,
     * así que cada paso se publica bajo su id saneado y bajo el slug de su título
     * en snake_case y camelCase.
     */
    private static async buildStepAliases(
        instanceId: string,
        templateSteps: WorkflowStep[]
    ): Promise<Record<string, unknown>> {
        const aliases: Record<string, unknown> = {};

        try {
            const rows = await db
                .select({
                    stepId: workflowInstanceSteps.stepId,
                    value: workflowInstanceSteps.value,
                    status: workflowInstanceSteps.status,
                })
                .from(workflowInstanceSteps)
                .where(eq(workflowInstanceSteps.instanceId, instanceId));

            const titleByStepId = new Map(
                templateSteps.map(s => [s.id, (s.title ?? '') as string])
            );

            for (const row of rows) {
                if (row.status !== 'COMPLETED') continue;

                const value = this.normalizeValue(row.value);
                const title = titleByStepId.get(row.stepId) ?? '';

                for (const name of [toSnakeCase(row.stepId), toSnakeCase(title), toCamelCase(title)]) {
                    if (name && IDENTIFIER_PATTERN.test(name)) {
                        aliases[name] = value;
                    }
                }
            }
        } catch (error) {
            console.error('[IncidentEngine] Error construyendo alias de pasos:', error);
        }

        return aliases;
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
     * @param stepDef - Definición del paso ya resuelta por el llamador (evita releer la plantilla)
     */
    static async checkIncidentConditions(
        instanceId: string,
        currentStepId: string,
        stepValue: unknown,
        aiResult?: AICheckResult,
        userId?: string,
        stepDef?: WorkflowStep
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

            // La definición de los pasos vive en workflow_templates.steps. El campo
            // `data.templateSteps` de la instancia se mantiene como respaldo para
            // instancias con pasos generados en tiempo de ejecución.
            const templateSteps = await this.loadTemplateSteps(instance);
            const currentStep = stepDef
                ?? templateSteps.find((s: WorkflowStep) => s.id === currentStepId);

            if (!currentStep) {
                console.warn(
                    `[IncidentEngine] Definición de paso no encontrada: ${currentStepId} ` +
                    `(plantilla ${instance.workflowTemplateId}). No se evalúan reglas.`
                );
                return [];
            }

            // Evaluate logicRules for this step
            const stepAliases = await this.buildStepAliases(instanceId, templateSteps);
            const matchedRules = this.evaluateLogicRules(
                currentStep,
                stepValue,
                aiResult,
                {
                    ...stepAliases,
                    gps_validation: (instance.data as Record<string, unknown> | null)?.gps_validation,
                }
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
            await IncidentEngine.afterResolution(incidentId, incident.instanceId);
        }

        return incident;
    }

    /**
     * Post-resolution cleanup shared by both manual and protocol resolution paths.
     * Cancels escalations and unblocks the workflow instance if no open incidents remain.
     */
    static async afterResolution(incidentId: string, instanceId: string): Promise<void> {
        const { EscalationService } = await import('./escalation-service');
        await EscalationService.cancelEscalation(incidentId);
        await this.unblockInstanceIfClear(instanceId);
    }

    /**
     * Devuelve la instancia a IN_PROGRESS cuando ya no queda ningún incidente
     * abierto que la bloquee. Sin esto un BLOCK dejaría el checklist marcado
     * como bloqueado para siempre.
     */
    private static async unblockInstanceIfClear(instanceId: string): Promise<void> {
        if (await this.hasBlockingIncidents(instanceId)) return;

        const [instance] = await db
            .select({ status: workflowInstances.status })
            .from(workflowInstances)
            .where(eq(workflowInstances.id, instanceId))
            .limit(1);

        if (instance?.status !== 'BLOCKED') return;

        console.log(`[IncidentEngine] Instancia ${instanceId} desbloqueada: sin incidentes bloqueantes`);

        // Se delega el estado a checkProgress: si el checklist ya estaba terminado
        // debe cerrarse ahora (y disparar sus acciones de cierre, que quedaron
        // pendientes mientras estuvo bloqueado), no quedarse en IN_PROGRESS.
        const { WorkflowExecutionService } = await import('./workflow-execution-service');
        await WorkflowExecutionService.recalculateProgress(instanceId);
    }
}

/**
 * Duracion legible entre deteccion y resolucion, para las plantillas.
 */
function formatearDuracion(desde: Date, hasta: Date): string {
    const minutos = Math.max(0, Math.round((hasta.getTime() - desde.getTime()) / 60000));
    if (minutos < 60) return `${minutos} min`;
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    if (horas < 24) return resto ? `${horas} h ${resto} min` : `${horas} h`;
    const dias = Math.floor(horas / 24);
    return `${dias} d ${horas % 24} h`;
}
