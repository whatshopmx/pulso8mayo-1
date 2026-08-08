
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { workflowTemplates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { WorkflowScheduleService } from '@/lib/services/workflow-schedule-service';
import { WorkflowTriggerService } from '@/lib/services/workflow-trigger-service';
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

        console.log(`[API] Fetching schedule settings for template ${templateId} in branch ${branchId}`);

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
        console.log(`[API] Saving schedule settings for template ${templateId}`, data);

        // 1. Update workflowTemplates row with metadata
        await db
            .update(workflowTemplates)
            .set({
                version: data.version ?? 1,
                active: data.activo ?? true,
                duracionEstimada: data.duracionEstimada ?? null,
                tags: data.tags ?? [],
                aiConfig: data.aiConfig ?? null,
                complianceConfig: data.complianceConfig ?? null,
                completionActions: data.completionActions ?? [],
                cumplimientoNormativo: data.cumplimientoNormativo ?? [],
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

        return NextResponse.json({ success: true });

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
    return steps.some((step: any) => step?.aiVerification?.enabled === true);
}

function getDayNumber(day: string): number {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days.indexOf(day.toLowerCase());
}

function getDayName(num: number): string {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[num] || 'monday';
}
