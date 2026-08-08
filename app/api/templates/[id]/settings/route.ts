
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { workflowTemplates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { WorkflowScheduleService } from '@/lib/services/workflow-schedule-service';
import { WorkflowTriggerService } from '@/lib/services/workflow-trigger-service';
import { roleIsAtLeast } from '@/lib/permissions';
import { checkScheduleFrequency } from '@/lib/compliance/frequency-requirements';
import { z } from 'zod';

const scheduleSchema = z.object({
  // Scheduling
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'on_demand']),
  shiftTimes: z.record(z.string(), z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)),
  days: z.array(z.string()).optional(),
  assignedRoles: z.array(z.string()).optional(),
  assignedShifts: z.array(z.string()).optional(),
  autoAssign: z.boolean(),
  triggers: z.array(z.object({
    eventName: z.string(),
    conditions: z.record(z.string(), z.any()).optional()
  })).optional(),

  // Template metadata
  version: z.number().optional(),
  activo: z.boolean().optional(),
  requiereIA: z.boolean().optional(),
  duracionEstimada: z.string().optional(),
  cumplimientoNormativo: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  aiConfig: z.object({
    provider: z.string().optional(),
    fallbackProvider: z.string().optional(),
    maxRetries: z.number().optional(),
  }).optional(),
  complianceConfig: z.object({
    complianceType: z.string().optional(),
    regulationSection: z.string().optional(),
    requiredFrequency: z.string().optional(),
    auditable: z.boolean().optional(),
    evidenceRequired: z.boolean().optional(),
    criticalForCompliance: z.boolean().optional(),
  }).optional(),
  completionActions: z.array(z.record(z.string(), z.any())).optional(),
});

/**
 * Campos que solo un ADMIN puede escribir, con el nombre que ve el usuario.
 *
 * El gate va por jerarquía de rol y por campo, nunca por PERMISSIONS (AD-3):
 * `PERMISSIONS.workflows` incluye `update` para GERENTE, SUPERVISOR y también
 * EMPLEADO — es el permiso con el que un empleado ejecuta pasos —, así que
 * `requirePermissionApi('workflows','update')` deja pasar a todo el mundo
 * salvo READONLY y no sirve como gate del editor.
 */
const PRIVILEGED_FIELDS: Record<string, string> = {
    complianceConfig: 'la configuración de cumplimiento',
    cumplimientoNormativo: 'las normas declaradas',
    aiConfig: 'la configuración de IA',
    version: 'la versión',
    activo: 'el estado activo de la plantilla',
};

/**
 * Devuelve el motivo del rechazo, o null si la escritura está permitida.
 */
function denySettingsWrite(
    role: string | undefined,
    templateScope: string | null | undefined,
    sentFields: string[]
): string | null {
    if (!roleIsAtLeast(role ?? '', 'GERENTE')) {
        return 'Editar la configuración de un flujo requiere rol Gerente o superior. ' +
            'Pídele el cambio a tu gerente o a un administrador.';
    }

    const isAdmin = roleIsAtLeast(role ?? '', 'ADMIN');

    if (templateScope === 'company' && !isAdmin) {
        return 'Este flujo es un playbook corporativo y su configuración afecta a varias ' +
            'sucursales: solo un administrador puede cambiarla. Para ajustar únicamente tu ' +
            'sucursal, usa una plantilla local.';
    }

    if (!isAdmin) {
        const touched = sentFields.filter((f) => f in PRIVILEGED_FIELDS);
        if (touched.length > 0) {
            const nombres = touched.map((f) => PRIVILEGED_FIELDS[f]);
            const lista = nombres.length === 1
                ? nombres[0]
                : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
            return `Cambiar ${lista} requiere rol Administrador. Como Gerente puedes editar ` +
                'la programación y las acciones de este flujo.';
        }
    }

    return null;
}

export async function GET(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;

    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });

        const user = session?.user as any;

        if (!user?.email || !user?.branchId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const templateId = params.id;
        const branchId = user.branchId;

        // Fetch template metadata, schedule and triggers in parallel
        const [template, schedule, triggers] = await Promise.all([
            db.query.workflowTemplates.findFirst({
                where: eq(workflowTemplates.id, templateId),
            }),
            WorkflowScheduleService.getScheduleByTemplateId(templateId, branchId),
            WorkflowTriggerService.getTriggersForTemplate(templateId, branchId)
        ]);

        // Build template metadata from DB row (or defaults if template not found)
        const templateMeta = {
            version: template?.version ?? 1,
            activo: template?.active ?? true,
            // Derivado, nunca almacenado (AD-4): lo que le importa a un auditor es
            // si el flujo *contiene* verificación por IA, no si hay proveedor
            // configurado. Como columna volvería a divergir al primer cambio.
            requiereIA: templateRequiresAI(template),
            duracionEstimada: template?.duracionEstimada ?? '',
            cumplimientoNormativo: (template?.cumplimientoNormativo as string[]) ?? [],
            tags: (template?.tags as string[]) ?? [],
            aiConfig: (template?.aiConfig as Record<string, any>) ?? null,
            complianceConfig: (template?.complianceConfig as Record<string, any>) ?? null,
            completionActions: (template?.completionActions as Record<string, any>[]) ?? [],
        };

        if (!schedule) {
            // Return defaults if no schedule exists
            return NextResponse.json({
                settings: {
                    ...templateMeta,
                    enabled: false,
                    frequency: 'daily',
                    shiftTimes: {
                        morning: '08:00',
                        afternoon: '15:00',
                        night: '23:00',
                        all: '08:00'
                    },
                    days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
                    assignedRoles: ['EMPLEADO'],
                    assignedShifts: ['morning'],
                    autoAssign: true,
                    triggers: triggers.map(t => ({
                        eventName: t.eventName,
                        conditions: t.conditions
                    }))
                }
            });
        }

        // Map DB model to frontend settings format
        // Handle both old format (single timeOfDay) and new format (JSON shiftTimes)
        let shiftTimes: Record<string, string>;
        try {
            shiftTimes = schedule.timeOfDay ? JSON.parse(schedule.timeOfDay) : {
                morning: '08:00',
                afternoon: '15:00',
                night: '23:00',
                all: '08:00'
            };
        } catch {
            const singleTime = schedule.timeOfDay || '08:00';
            shiftTimes = {
                morning: singleTime,
                afternoon: singleTime,
                night: singleTime,
                all: singleTime
            };
        }

        // Las columnas de array son la fuente de verdad. Las escalares solo se
        // consultan cuando el array está vacío, para filas escritas antes de la
        // migración 0038 por un camino que no pasó por el backfill.
        const daysOfWeek = (schedule.daysOfWeek as string[] | null) ?? [];
        const assignedRoles = (schedule.assignedRoles as string[] | null) ?? [];

        const settings = {
            ...templateMeta,
            enabled: schedule.isActive,
            frequency: schedule.frequency.toLowerCase(),
            shiftTimes,
            days: daysOfWeek.length > 0
                ? daysOfWeek
                : schedule.dayOfWeek !== null ? [getDayName(schedule.dayOfWeek)] : [],
            assignedRoles: assignedRoles.length > 0
                ? assignedRoles
                : schedule.assignedRole ? [schedule.assignedRole] : [],
            assignedShifts: (schedule.assignedShifts as string[] | null) ?? [],
            autoAssign: schedule.assignmentType === 'AUTO',
            triggers: triggers.map(t => ({
                eventName: t.eventName,
                conditions: t.conditions
            }))
        };

        return NextResponse.json({ settings });

    } catch (error: any) {
        console.error('[API] Error fetching schedule settings:', error);
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;

    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });

        const user = session?.user as any;

        if (!user?.email || !user?.branchId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const templateId = params.id;
        const branchId = user.branchId;
        const body = await req.json();

        // Validate body
        const validation = scheduleSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { error: 'Invalid settings', details: validation.error.format() },
                { status: 400 }
            );
        }

        const data = validation.data;

        const template = await db.query.workflowTemplates.findFirst({
            where: eq(workflowTemplates.id, templateId),
        });

        if (!template) {
            return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 });
        }

        const denied = denySettingsWrite(
            user.role,
            template.scope,
            Object.keys(body ?? {})
        );
        if (denied) {
            return NextResponse.json({ error: denied }, { status: 403 });
        }

        // D1: la programación se compara contra el mínimo de la norma. La norma
        // efectiva es la que trae este guardado; si no manda complianceConfig
        // (un gerente, por el gate), se usa la que ya tiene la plantilla.
        const storedCompliance = template.complianceConfig as { complianceType?: string } | null;
        const complianceType = data.complianceConfig?.complianceType ?? storedCompliance?.complianceType;
        const frequencyCheck = checkScheduleFrequency(
            complianceType,
            data.frequency,
            process.env.COMPLIANCE_FREQ_ENFORCE === 'false'
        );

        if (frequencyCheck.blocking) {
            // 422 y no se escribe nada: rechazar a medias dejaría la plantilla
            // con la programación nueva y la norma vieja.
            return NextResponse.json(
                { error: frequencyCheck.warnings[0], warnings: frequencyCheck.warnings },
                { status: 422 }
            );
        }

        // 1. Update workflowTemplates row with metadata.
        //
        // Un campo ausente conserva lo que había. Con `?? valorPorDefecto` un
        // guardado que no incluyera complianceConfig lo ponía en null: ahora que
        // el gate hace que un Gerente no mande los campos privilegiados, eso
        // habría borrado la configuración del administrador en cada guardado.
        await db
            .update(workflowTemplates)
            .set({
                version: data.version ?? template.version,
                active: data.activo ?? template.active,
                duracionEstimada: data.duracionEstimada ?? template.duracionEstimada,
                tags: data.tags ?? template.tags,
                aiConfig: data.aiConfig ?? template.aiConfig,
                complianceConfig: data.complianceConfig ?? template.complianceConfig,
                completionActions: data.completionActions ?? template.completionActions,
                cumplimientoNormativo: data.cumplimientoNormativo ?? template.cumplimientoNormativo,
                updatedAt: new Date(),
            })
            .where(eq(workflowTemplates.id, templateId));

        // 2. Create or update schedule
        const existingSchedule = await WorkflowScheduleService.getScheduleByTemplateId(templateId, branchId);

        const dbFrequency = (data.frequency === 'on_demand' ? 'ONCE' : data.frequency.toUpperCase()) as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONCE';

        const days = data.days ?? [];
        const assignedRoles = data.assignedRoles ?? [];

        // Las escalares siguen recibiendo el primer elemento (AD-7): el cron y el
        // motor de ejecución todavía las leen. Las de array guardan la selección
        // completa, que es lo que el usuario configuró.
        let dayOfWeek: number | undefined;
        if (dbFrequency === 'WEEKLY' && days.length > 0) {
            dayOfWeek = getDayNumber(days[0]);
        }

        const scheduleData = {
            templateId,
            branchId,
            assignmentType: data.autoAssign ? 'AUTO' : 'ROLE',
            assignedRole: assignedRoles.length > 0 ? assignedRoles[0] as any : null,
            assignedRoles,
            assignedShifts: data.assignedShifts ?? [],
            frequency: dbFrequency,
            timeOfDay: JSON.stringify(data.shiftTimes),
            dayOfWeek: dayOfWeek,
            daysOfWeek: days,
            startDate: new Date(),
            title: `Schedule for ${templateId}`,
            createdBy: user.id,
            isActive: data.enabled
        };

        if (existingSchedule) {
            await WorkflowScheduleService.updateSchedule(existingSchedule.id, {
                ...scheduleData,
                assignmentType: scheduleData.assignmentType as any,
                assignedRole: scheduleData.assignedRole,
                frequency: scheduleData.frequency,
            });
        } else {
            await WorkflowScheduleService.createSchedule({
                ...scheduleData,
                assignmentType: scheduleData.assignmentType as any,
                assignedRole: scheduleData.assignedRole,
                frequency: scheduleData.frequency,
            });
        }

        // 3. Save Triggers
        if (data.triggers) {
            await WorkflowTriggerService.syncTriggers(
                templateId,
                branchId,
                data.triggers.map(t => ({ ...t, conditions: t.conditions || {} })),
                user.id
            );
        }

        return NextResponse.json({ success: true, warnings: frequencyCheck.warnings });

    } catch (error: any) {
        console.error('[API] Error saving schedule settings:', error);
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}

// Helpers

/**
 * AD-4: `requiereIA` no tiene columna. Se deriva de los pasos porque lo que
 * responde a un auditor es si el flujo *contiene* verificación por IA, no si
 * hay proveedor configurado; `aiConfig` se mantiene en el OR para las
 * plantillas que declaran proveedor sin pasos de IA todavía.
 */
function templateRequiresAI(template?: { steps?: unknown; aiConfig?: unknown } | null): boolean {
    if (template?.aiConfig != null) return true;
    const steps = template?.steps;
    if (!Array.isArray(steps)) return false;
    return steps.some(
        (step: { aiVerification?: { enabled?: boolean } } | null) =>
            step?.aiVerification?.enabled === true
    );
}

function getDayNumber(day: string): number {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days.indexOf(day.toLowerCase());
}

function getDayName(num: number): string {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[num] || 'monday';
}
