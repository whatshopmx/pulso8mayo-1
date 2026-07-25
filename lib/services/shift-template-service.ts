/**
 * Shift Template Service
 * Manages shift templates and bulk operations
 */

import { ShiftTemplate, Shift, BulkShiftOperation, ApplyTemplateResult, TemplatePreview } from "@/lib/types/shifts";
import { plannedShiftService } from "./shift-service-extended";
import { addDays, format, parseISO, startOfWeek, getDay, eachDayOfInterval, isSameDay } from "date-fns";

// Predefined templates
export const DEFAULT_TEMPLATES: Omit<ShiftTemplate, "id" | "createdAt" | "updatedAt">[] = [
  {
    name: "Restaurante Completo",
    description: "2 Cocineros, 2 Meseros, 1 Cajero, 1 Limpieza",
    branchId: "",
    role: "COCINERO",
    startTime: "07:00",
    endTime: "15:00",
    daysOfWeek: [1, 2, 3, 4, 5, 6, 0],
    isActive: true,
  },
  {
    name: "Turno Mañana",
    description: "1 Cocinero, 1 Mesero, 1 Cajero (7:00-15:00)",
    branchId: "",
    role: "COCINERO",
    startTime: "07:00",
    endTime: "15:00",
    daysOfWeek: [1, 2, 3, 4, 5],
    isActive: true,
  },
  {
    name: "Turno Tarde",
    description: "1 Cocinero, 1 Mesero, 1 Cajero (15:00-23:00)",
    branchId: "",
    role: "COCINERO",
    startTime: "15:00",
    endTime: "23:00",
    daysOfWeek: [1, 2, 3, 4, 5, 6],
    isActive: true,
  },
  {
    name: "Fin de Semana",
    description: "Personal reducido con seguridad",
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
   */
  async applyBulkOperation(operation: BulkShiftOperation): Promise<ApplyTemplateResult> {
    const created: Shift[] = [];
    const failed: { date: string; error: string }[] = [];

    const startDate = parseISO(operation.startDate);
    const endDate = parseISO(operation.endDate);

    // Generate dates based on pattern
    const dates = this.generateDates(startDate, endDate, operation.pattern, operation.daysOfWeek);

    // Determine shift times
    const { startTime, endTime } = this.getShiftTimes(operation.shiftType, operation.customStartTime, operation.customEndTime);

    // Create shifts for each employee and date
    for (const date of dates) {
      for (const employeeId of operation.employeeIds) {
        try {
          const shift = await plannedShiftService.createPlannedShift({
            companyId: (operation as any).companyId || "",
            userId: employeeId,
            branchId: "", // Will be determined by context
            role: "", // Will be determined by context
            shiftDate: format(date, "yyyy-MM-dd"),
            startTime,
            endTime,
            status: "DRAFT",
          });
          created.push(shift);
        } catch (error) {
          failed.push({
            date: format(date, "yyyy-MM-dd"),
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }

    return { created, failed };
  }

  /**
   * Preview what shifts would be created by a bulk operation
   */
  previewBulkOperation(operation: BulkShiftOperation): TemplatePreview[] {
    const startDate = parseISO(operation.startDate);
    const endDate = parseISO(operation.endDate);
    const dates = this.generateDates(startDate, endDate, operation.pattern, operation.daysOfWeek);
    const { startTime, endTime } = this.getShiftTimes(operation.shiftType, operation.customStartTime, operation.customEndTime);

    return dates.map((date) => ({
      date: format(date, "yyyy-MM-dd"),
      startTime,
      endTime,
      role: "COCINERO", // Default role
      employeeCount: operation.employeeIds.length,
    }));
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
    template: ShiftTemplate,
    date: Date,
    employeeId: string
  ): Promise<Shift> {
    return plannedShiftService.createPlannedShift({
      companyId: (template as any).companyId || "",
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
