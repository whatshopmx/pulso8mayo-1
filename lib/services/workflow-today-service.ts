import { db } from "@/lib/db";
import { users, workflowInstances, workflowSchedules, workflowTemplates } from "@/lib/db/schema";
import { branches } from "@/lib/db/schema/core";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import {
    deriveItemState,
    isScheduleDueOn,
    localDayRangeUtc,
    localMoment,
    normalizeShifts,
    parseTimeOfDay,
    STATE_SEVERITY,
    type TodayItemState,
} from "@/lib/workflows/today";

export interface TodayItem {
    scheduleId: string;
    templateId: string;
    title: string;
    /** "HH:MM" local de la sucursal, o null si la programación no fija hora. */
    timeOfDay: string | null;
    shift: string | null;
    state: TodayItemState;
    /** Ejecución ligada, si ya se creó. */
    executionId: string | null;
    completedAt: string | null;
    /**
     * A quién le toca, cuando la programación nombra a una persona concreta.
     * Con `assignedRole` no hay un solo destinatario, así que queda null y el
     * envío por WhatsApp cae a elegir contacto a mano.
     */
    assignee: { name: string | null; whatsappPhone: string | null } | null;
}

export interface TodayBranchRollup {
    branchId: string;
    branchName: string;
    /** Fecha local de la sucursal (YYYY-MM-DD): su "hoy" puede no ser el tuyo. */
    localDate: string;
    expected: number;
    done: number;
    overdue: number;
    /** null cuando la sucursal no tiene ninguna programación para hoy. */
    worstState: TodayItemState | null;
}

export interface TodayBranchDay extends TodayBranchRollup {
    items: TodayItem[];
}

/** Fecha local de la sucursal en ISO corto, para etiquetar el tablero. */
function localDateLabel(at: Date, timeZone: string | null): string {
    const m = localMoment(at, timeZone);
    return `${m.year}-${String(m.month).padStart(2, "0")}-${String(m.day).padStart(2, "0")}`;
}

/**
 * Lo que se esperaba hoy en cada sucursal, contra lo que realmente pasó.
 *
 * Tres consultas en total: sucursales, programaciones y ejecuciones del día.
 * El cruce se hace en memoria porque cada sucursal tiene su propio "hoy" y no
 * se puede expresar como un solo rango en SQL.
 */
export class WorkflowTodayService {

    static async getToday(companyId: string, branchId?: string | null, at: Date = new Date()) {
        const branchRows = await db
            .select({ id: branches.id, name: branches.name, timezone: branches.timezone })
            .from(branches)
            .where(
                branchId
                    ? and(eq(branches.companyId, companyId), eq(branches.id, branchId))
                    : and(eq(branches.companyId, companyId), eq(branches.active, true))
            );

        if (branchRows.length === 0) {
            return { generatedAt: at.toISOString(), branches: [] as TodayBranchDay[] };
        }

        const branchIds = branchRows.map((b) => b.id);

        // Las programaciones se limitan a plantillas de la empresa: workflow_schedules
        // no guarda company_id, igual que workflow_instances.
        const scheduleRows = await db
            .select({
                id: workflowSchedules.id,
                templateId: workflowSchedules.templateId,
                branchId: workflowSchedules.branchId,
                title: workflowSchedules.title,
                frequency: workflowSchedules.frequency,
                dayOfWeek: workflowSchedules.dayOfWeek,
                daysOfWeek: workflowSchedules.daysOfWeek,
                dayOfMonth: workflowSchedules.dayOfMonth,
                timeOfDay: workflowSchedules.timeOfDay,
                startDate: workflowSchedules.startDate,
                endDate: workflowSchedules.endDate,
                isActive: workflowSchedules.isActive,
                assignedShifts: workflowSchedules.assignedShifts,
                templateName: workflowTemplates.name,
                assigneeName: users.name,
                assigneePhone: users.whatsappPhone,
            })
            .from(workflowSchedules)
            .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowSchedules.templateId))
            .leftJoin(users, eq(users.id, workflowSchedules.assignedUserId))
            .where(
                and(
                    inArray(workflowSchedules.branchId, branchIds),
                    eq(workflowSchedules.isActive, true),
                    eq(workflowTemplates.companyId, companyId)
                )
            );

        // Ventana que cubre el día local de todas las sucursales a la vez; luego
        // cada ejecución se asigna al día de su propia sucursal.
        const ranges = new Map(branchRows.map((b) => [b.id, localDayRangeUtc(at, b.timezone)]));
        const windowStart = new Date(Math.min(...[...ranges.values()].map((r) => r.start.getTime())));
        const windowEnd = new Date(Math.max(...[...ranges.values()].map((r) => r.end.getTime())));

        const instanceRows = await db
            .select({
                id: workflowInstances.id,
                branchId: workflowInstances.branchId,
                scheduleId: workflowInstances.scheduleId,
                status: workflowInstances.status,
                createdAt: workflowInstances.createdAt,
                completedAt: workflowInstances.completedAt,
            })
            .from(workflowInstances)
            .where(
                and(
                    inArray(workflowInstances.branchId, branchIds),
                    gte(workflowInstances.createdAt, windowStart),
                    lt(workflowInstances.createdAt, windowEnd)
                )
            );

        const result: TodayBranchDay[] = branchRows.map((branch) => {
            const range = ranges.get(branch.id)!;
            const day = localMoment(at, branch.timezone);

            // Sólo las ejecuciones que caen dentro del día local de ESTA sucursal.
            const byScheduleId = new Map<string, typeof instanceRows[number]>();
            for (const instance of instanceRows) {
                if (instance.branchId !== branch.id || !instance.scheduleId) continue;
                const created = instance.createdAt?.getTime() ?? 0;
                if (created < range.start.getTime() || created >= range.end.getTime()) continue;

                // Si una programación corrió varias veces hoy, gana la más avanzada.
                const existing = byScheduleId.get(instance.scheduleId);
                if (!existing || rank(instance.status) < rank(existing.status)) {
                    byScheduleId.set(instance.scheduleId, instance);
                }
            }

            const items: TodayItem[] = scheduleRows
                .filter((s) => s.branchId === branch.id && isScheduleDueOn(s, day, branch.timezone))
                .map((s) => {
                    const instance = byScheduleId.get(s.id) ?? null;
                    const dueMinutes = parseTimeOfDay(s.timeOfDay);
                    const shifts = normalizeShifts(s.assignedShifts);
                    return {
                        scheduleId: s.id,
                        templateId: s.templateId,
                        title: s.title || s.templateName || "Sin nombre",
                        timeOfDay: s.timeOfDay ?? null,
                        shift: shifts[0] ?? null,
                        state: deriveItemState(instance?.status, dueMinutes, day.minutesOfDay),
                        executionId: instance?.id ?? null,
                        completedAt: instance?.completedAt?.toISOString() ?? null,
                        assignee: s.assigneeName || s.assigneePhone
                            ? { name: s.assigneeName ?? null, whatsappPhone: s.assigneePhone ?? null }
                            : null,
                    };
                })
                .sort((a, b) => {
                    const at_ = parseTimeOfDay(a.timeOfDay);
                    const bt = parseTimeOfDay(b.timeOfDay);
                    // Los pasos sin hora van al final, no al amanecer.
                    if (at_ === null && bt === null) return a.title.localeCompare(b.title, "es");
                    if (at_ === null) return 1;
                    if (bt === null) return -1;
                    return at_ - bt;
                });

            const done = items.filter((i) => i.state === "HECHO").length;
            const overdue = items.filter((i) => i.state === "VENCIDO").length;
            const worstState = items.length === 0
                ? null
                : items.reduce<TodayItemState>(
                    (worst, i) => (STATE_SEVERITY[i.state] < STATE_SEVERITY[worst] ? i.state : worst),
                    "HECHO"
                );

            return {
                branchId: branch.id,
                branchName: branch.name,
                localDate: localDateLabel(at, branch.timezone),
                expected: items.length,
                done,
                overdue,
                worstState,
                items,
            } as TodayBranchDay;
        });

        // Lo que urge primero. Las sucursales sin programación van al final: no
        // están mal, simplemente no tienen nada que reportar hoy.
        result.sort((a, b) => {
            if (a.worstState === null && b.worstState === null) return a.branchName.localeCompare(b.branchName, "es");
            if (a.worstState === null) return 1;
            if (b.worstState === null) return -1;
            const bySeverity = STATE_SEVERITY[a.worstState] - STATE_SEVERITY[b.worstState];
            if (bySeverity !== 0) return bySeverity;
            if (b.overdue !== a.overdue) return b.overdue - a.overdue;
            return a.branchName.localeCompare(b.branchName, "es");
        });

        return { generatedAt: at.toISOString(), branches: result };
    }
}

/** COMPLETED gana sobre IN_PROGRESS, que gana sobre lo demás. */
function rank(status: string | null): number {
    if (status === "COMPLETED") return 0;
    if (status === "IN_PROGRESS") return 1;
    return 2;
}
