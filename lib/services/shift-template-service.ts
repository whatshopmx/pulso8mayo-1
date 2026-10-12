/**
 * Shift Template Service
 * Manages shift templates and bulk operations
 */

import { ShiftTemplate, Shift, BulkShiftOperation, ApplyTemplateResult, TemplatePreview, type CreateShiftInput } from "@/lib/types/shifts";
import { plannedShiftService, PlannedShiftServiceImpl } from "./shift-service-extended";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { resolveShiftScope, assertShiftScopeCoversBranch, type ShiftActor } from "@/lib/labor/shift-access";
import type { TurnoAValidar } from "@/lib/labor/shift-rules";
import { ApiError } from "@/lib/api/error";
import { z } from "zod";
import { differenceInCalendarDays, format, parseISO, getDay, eachDayOfInterval, isValid } from "date-fns";

const date = z.string().refine((value) => {
  const parsed = parseISO(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parsed) && format(parsed, "yyyy-MM-dd") === value;
}, "Usa una fecha válida en formato AAAA-MM-DD.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usa una hora válida en formato HH:mm.");
const operationSchema = z.object({
  branchId: z.string().trim().min(1, "Selecciona una sucursal."),
  role: z.string().trim().min(1, "Selecciona un rol."),
  employeeIds: z.array(z.string().trim().min(1)).min(1, "Selecciona al menos un empleado."),
  startDate: date, endDate: date,
  pattern: z.enum(["daily", "weekly", "custom"]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  shiftType: z.enum(["MATUTINO", "VESPERTINO", "NOCTURNO", "MIXTO", "CUSTOM"]),
  customStartTime: time.optional(), customEndTime: time.optional(),
}).refine((value) => value.startDate <= value.endDate, "La fecha final debe ser igual o posterior a la inicial.")
  .refine((value) => value.pattern !== "custom" || !!value.daysOfWeek?.length, "Selecciona días para el patrón personalizado.")
  .refine((value) => value.shiftType !== "CUSTOM" || (!!value.customStartTime && !!value.customEndTime), "Indica las dos horas del turno.");

// Predefined templates
export const DEFAULT_TEMPLATES: Omit<ShiftTemplate, "id" | "createdAt" | "updatedAt">[] = [
  {
    name: "Restaurante Completo",
    description: "Horario de 07:00 a 15:00 todos los días; selecciona el personal y rol.",
    branchId: "",
    role: "COCINERO",
    startTime: "07:00",
    endTime: "15:00",
    daysOfWeek: [1, 2, 3, 4, 5, 6, 0],
    isActive: true,
  },
  {
    name: "Turno Mañana",
    description: "Horario de 07:00 a 15:00 de lunes a viernes.",
    branchId: "",
    role: "COCINERO",
    startTime: "07:00",
    endTime: "15:00",
    daysOfWeek: [1, 2, 3, 4, 5],
    isActive: true,
  },
  {
    name: "Turno Tarde",
    description: "Horario de 15:00 a 23:00 de lunes a sábado.",
    branchId: "",
    role: "COCINERO",
    startTime: "15:00",
    endTime: "23:00",
    daysOfWeek: [1, 2, 3, 4, 5, 6],
    isActive: true,
  },
  {
    name: "Fin de Semana",
    description: "Horario de 10:00 a 22:00 los fines de semana; requiere excepción de jornada.",
    branchId: "",
    role: "MESERO",
    startTime: "10:00",
    endTime: "22:00",
    daysOfWeek: [6, 0],
    isActive: true,
  },
];

export const SHIFT_TYPE_SCHEDULES = {
  MATUTINO: { start: "07:00", end: "15:00" },
  VESPERTINO: { start: "15:00", end: "23:00" },
  NOCTURNO: { start: "23:00", end: "07:00" },
  MIXTO: { start: "10:00", end: "18:00" },
} as const;

export class ShiftTemplateService {
  /**
   * Apply a bulk shift operation to create multiple shifts
   *
   * Resultado por empleado/fecha. Cada elemento pasa por la puerta de escritura
   * vigente; un rechazo no revierte los válidos ni escribe ese elemento.
   */
  async applyBulkOperation(
    actor: ShiftActor,
    operation: BulkShiftOperation
  ): Promise<ApplyTemplateResult> {
    const created: Shift[] = [];
    const failed: ApplyTemplateResult["failed"] = [];
    for (const input of this.inputs(actor, operation)) {
      try {
        const shift = await db.transaction(async (tx) => {
          // Serializa aplicaciones de lote del mismo empleado, incluso entre
          // procesos. La lectura de conflictos y el insert usan esta transacción.
          // PostgreSQL libera el bloqueo al confirmar o revertir el elemento:
          // https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
          const key = JSON.stringify(["shift-batch", actor.companyId, input.userId]);
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
          return new PlannedShiftServiceImpl(tx).createPlannedShift(actor, input);
        });
        created.push(shift);
      } catch (error) {
        failed.push({
          date: input.shiftDate,
          employeeId: input.userId,
          error: error instanceof Error ? error.message : "Error desconocido",
        });
      }
    }

    return { created, failed };
  }

  /**
   * Preview what shifts would be created by a bulk operation
   */
  async previewBulkOperation(actor: ShiftActor, operation: BulkShiftOperation): Promise<TemplatePreview[]> {
    const accepted: TurnoAValidar[] = [];
    const preview: TemplatePreview[] = [];
    for (const input of this.inputs(actor, operation)) {
      const row: TemplatePreview = {
        date: input.shiftDate, employeeId: input.userId, branchId: input.branchId,
        role: input.role, startTime: input.startTime, endTime: input.endTime,
        employeeCount: 1, canApply: false, warnings: [],
      };
      try {
        row.warnings = await plannedShiftService.validatePlannedShift(actor, input, accepted);
        row.canApply = true;
        accepted.push({ ...input, id: `preview:${input.userId}:${input.shiftDate}` });
      } catch (error) {
        row.error = error instanceof Error ? error.message : "Error desconocido";
      }
      preview.push(row);
    }
    return preview;
  }

  private inputs(actor: ShiftActor, request: BulkShiftOperation): CreateShiftInput[] {
    const parsed = operationSchema.safeParse(request);
    if (!parsed.success) throw ApiError.badRequest(parsed.error.issues.map((issue) => issue.message).join(" "));
    const operation = parsed.data;
    assertShiftScopeCoversBranch(resolveShiftScope(actor, operation.branchId), operation.branchId);
    const start = parseISO(operation.startDate), end = parseISO(operation.endDate);
    // Límites de tamaño de petición, no límites de jornada.
    if (differenceInCalendarDays(end, start) > 30) throw ApiError.badRequest("Aplica hasta 31 días por solicitud.");
    const dates = this.generateDates(start, end, operation.pattern, operation.daysOfWeek);
    const employeeIds = [...new Set(operation.employeeIds)];
    if (!dates.length) throw ApiError.badRequest("La plantilla no tiene días en el periodo seleccionado.");
    if (dates.length * employeeIds.length > 500) throw ApiError.badRequest("Aplica hasta 500 turnos por solicitud.");
    const times = this.getShiftTimes(operation.shiftType, operation.customStartTime, operation.customEndTime);
    return dates.flatMap((date) => employeeIds.map((userId) => ({
      companyId: actor.companyId, userId, branchId: operation.branchId, role: operation.role,
      shiftDate: format(date, "yyyy-MM-dd"), ...times, status: "DRAFT" as const,
    })));
  }

  /**
   * Generate shift dates based on pattern
   */
  private generateDates(
    start: Date,
    end: Date,
    pattern: string,
    daysOfWeek?: number[]
  ): Date[] {
    const allDates = eachDayOfInterval({ start, end });

    switch (pattern) {
      case "daily":
        return allDates;
      case "weekly":
        return allDates.filter((d) => getDay(d) === 1); // Mondays
      case "custom":
        return daysOfWeek ? allDates.filter((d) => daysOfWeek.includes(getDay(d))) : allDates;
      default:
        return allDates;
    }
  }

  /**
   * Get shift times based on shift type
   */
  private getShiftTimes(
    shiftType: string,
    customStart?: string,
    customEnd?: string
  ): { startTime: string; endTime: string } {
    if (shiftType === "CUSTOM" && customStart && customEnd) {
      return { startTime: customStart, endTime: customEnd };
    }

    const schedule = SHIFT_TYPE_SCHEDULES[shiftType as keyof typeof SHIFT_TYPE_SCHEDULES];
    if (schedule) {
      return { startTime: schedule.start, endTime: schedule.end };
    }

    return { startTime: "09:00", endTime: "17:00" }; // Default
  }

  /**
   * Create a shift from a template
   */
  async createShiftFromTemplate(
    actor: ShiftActor,
    template: ShiftTemplate,
    date: Date,
    employeeId: string
  ): Promise<Shift> {
    return plannedShiftService.createPlannedShift(actor, {
      companyId: actor.companyId,
      userId: employeeId,
      branchId: template.branchId,
      role: template.role,
      shiftDate: format(date, "yyyy-MM-dd"),
      startTime: template.startTime,
      endTime: template.endTime,
      status: "DRAFT",
    });
  }

  /**
   * Get templates for a specific branch
   */
  getTemplatesForBranch(branchId: string): Omit<ShiftTemplate, "id" | "createdAt" | "updatedAt">[] {
    return DEFAULT_TEMPLATES.map((t) => ({ ...t, branchId }));
  }
}

export const shiftTemplateService = new ShiftTemplateService();
