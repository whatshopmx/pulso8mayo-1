/**
 * Extended Shift Service for Planned Shifts CRUD Operations
 * 
 * This module extends the ShiftService with methods for managing planned shifts
 * including filtering, creation, updates, deletion, bulk operations, and duplication.
 */

import { db } from "@/lib/db";
import { plannedShifts } from "@/lib/db/schema";
import { eq, and, between, sql, desc } from "drizzle-orm";
import { resolveShiftScope, type ShiftActor } from "@/lib/labor/shift-access";
import {
  Shift,
  ShiftFilters,
  CreateShiftInput,
  BulkCreateResult,
  DuplicateOptions,
  LFTViolation,
  LFTViolationType,
} from "@/lib/types/shifts";
import { parseISO, startOfWeek, addWeeks, differenceInDays, format } from "date-fns";

// Extended interface for shift service with planned shifts operations
export interface PlannedShiftService {
  getPlannedShifts(actor: ShiftActor, filters: ShiftFilters): Promise<Shift[]>;
  createPlannedShift(data: CreateShiftInput): Promise<Shift>;
  updatePlannedShift(id: string, data: Partial<CreateShiftInput>): Promise<Shift>;
  deletePlannedShift(id: string): Promise<void>;
  bulkCreateShifts(inputs: CreateShiftInput[]): Promise<BulkCreateResult>;
  publishShifts(shiftIds: string[]): Promise<void>;
  duplicateShifts(shiftIds: string[], options: DuplicateOptions): Promise<Shift[]>;
  validateShift(shift: Shift, existingShifts: Shift[]): Promise<{ isValid: boolean; violations: LFTViolation[] }>;
}

/**
 * Service for managing planned shifts
 */
export class PlannedShiftServiceImpl implements PlannedShiftService {
  // LFT Limits (Mexico) - in minutes
  private static readonly DAILY_HOURS_LIMIT = 8 * 60; // 8 hours in minutes
  private static readonly WEEKLY_HOURS_LIMIT = 48 * 60; // 48 hours in minutes
  private static readonly REST_BETWEEN_SHIFTS = 8 * 60; // 8 hours in minutes
  private static readonly MAX_CONSECUTIVE_DAYS = 6;

  /**
   * Get planned shifts with filters
   *
   * El actor es obligatorio y va primero a propósito: sin él esta consulta es
   * una puerta abierta a los turnos de todas las empresas, así que no se puede
   * "olvidar" (H01). Lo construye `requireAuth()`, nunca el cuerpo de la
   * petición.
   *
   * El alcance se resuelve con `lib/labor/shift-access.ts`: `BRANCH` añade el
   * filtro de sucursal y `NONE` devuelve cero filas sin tocar la base. Un
   * `GERENTE`/`SUPERVISOR` acotado sin sucursal asignada no debe caer en el
   * `undefined` de "sin condiciones", que era como se leía la empresa entera.
   */
  async getPlannedShifts(actor: ShiftActor, filters: ShiftFilters = {}): Promise<Shift[]> {
    const alcance = resolveShiftScope(actor, filters.branchId);

    // `NONE` significa "no lees nada", no "filtra por nada". Un return temprano
    // deja además la consulta fuera del log de consultas lentas.
    if (alcance.kind === "NONE") return [];

    const conditions: (ReturnType<typeof eq> | ReturnType<typeof and> | ReturnType<typeof sql>)[] = [
      // Siempre primero: es la condición que ningún filtro del cliente puede
      // quitar ni ampliar.
      eq(plannedShifts.companyId, actor.companyId),
    ];

    if (alcance.kind === "BRANCH") {
      conditions.push(eq(plannedShifts.branchId, alcance.branchId));
    }

    if (filters.employeeId) {
      conditions.push(eq(plannedShifts.userId, filters.employeeId));
    }

    if (filters.role) {
      conditions.push(eq(plannedShifts.role, filters.role));
    }

    if (filters.startDate && filters.endDate) {
      conditions.push(
        between(
          plannedShifts.shiftDate,
          filters.startDate,
          filters.endDate
        )
      );
    } else if (filters.startDate) {
      conditions.push(sql`${plannedShifts.shiftDate} >= ${filters.startDate}`);
    } else if (filters.endDate) {
      conditions.push(sql`${plannedShifts.shiftDate} <= ${filters.endDate}`);
    }

    if (filters.status && filters.status.length > 0) {
      // Use IN clause for status array
      const statusPlaceholders = filters.status.map((_, i) => `$${i + 1}`).join(',');
      conditions.push(sql`${plannedShifts.status} IN (${sql.raw(statusPlaceholders)})`);
    }

    const shifts = await db.query.plannedShifts.findMany({
      where: and(...conditions),
      orderBy: [
        desc(plannedShifts.shiftDate),
        desc(plannedShifts.startTime),
      ],
    });

    // Transform to Shift type with user and branch names
    const shiftsWithNames: Shift[] = shifts.map((shift) => ({
      ...shift,
      companyId: shift.companyId,
      userName: shift.userId, // Will be populated by separate query or join
      branchName: shift.branchId, // Will be populated
      status: shift.status as 'DRAFT' | 'PUBLISHED' | 'CANCELLED',
      createdAt: shift.createdAt.toISOString(),
      updatedAt: shift.updatedAt.toISOString(),
    }));

    // Apply search filter if provided
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      return shiftsWithNames.filter(
        (shift) =>
          shift.userName?.toLowerCase().includes(searchLower) ||
          shift.userEmail?.toLowerCase().includes(searchLower) ||
          shift.branchName?.toLowerCase().includes(searchLower)
      );
    }

    return shiftsWithNames;
  }

  /**
   * Create a planned shift
   */
  async createPlannedShift(data: CreateShiftInput): Promise<Shift> {
    // Check for overlapping shifts
    const existingShifts = await db.query.plannedShifts.findMany({
      where: and(
        eq(plannedShifts.userId, data.userId),
        eq(plannedShifts.shiftDate, data.shiftDate),
        sql`${plannedShifts.status} != 'CANCELLED'`
      ),
    });

    const hasOverlap = existingShifts.some((existing) => {
      const existingStart = existing.startTime;
      const existingEnd = existing.endTime;
      return (
        (data.startTime < existingEnd && data.endTime > existingStart)
      );
    });

    if (hasOverlap) {
      throw new Error('El empleado ya tiene un turno programado que se solapa con este horario');
    }

    const [shift] = await db
      .insert(plannedShifts)
      .values({
        companyId: data.companyId,
        userId: data.userId,
        branchId: data.branchId,
        role: data.role,
        shiftDate: data.shiftDate,
        startTime: data.startTime,
        endTime: data.endTime,
        notes: data.notes || null,
        status: data.status || 'DRAFT',
      })
      .returning();

    return {
      ...shift,
      companyId: shift.companyId,
      userName: '',
      userEmail: '',
      branchName: '',
      status: shift.status as 'DRAFT' | 'PUBLISHED' | 'CANCELLED',
      createdAt: shift.createdAt.toISOString(),
      updatedAt: shift.updatedAt.toISOString(),
    };
  }

  /**
   * Update a planned shift
   */
  async updatePlannedShift(
    id: string,
    data: Partial<CreateShiftInput>
  ): Promise<Shift> {
    const [shift] = await db
      .update(plannedShifts)
      .set({
        ...(data.userId && { userId: data.userId }),
        ...(data.branchId && { branchId: data.branchId }),
        ...(data.role && { role: data.role }),
        ...(data.shiftDate && { shiftDate: data.shiftDate }),
        ...(data.startTime && { startTime: data.startTime }),
        ...(data.endTime && { endTime: data.endTime }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
        ...(data.status && { status: data.status }),
        updatedAt: new Date(),
      })
      .where(eq(plannedShifts.id, id))
      .returning();

    if (!shift) {
      throw new Error('Turno no encontrado');
    }

    return {
      ...shift,
      companyId: shift.companyId,
      userName: '',
      userEmail: '',
      branchName: '',
      status: shift.status as 'DRAFT' | 'PUBLISHED' | 'CANCELLED',
      createdAt: shift.createdAt.toISOString(),
      updatedAt: shift.updatedAt.toISOString(),
    };
  }

  /**
   * Delete a planned shift
   */
  async deletePlannedShift(id: string): Promise<void> {
    await db.delete(plannedShifts).where(eq(plannedShifts.id, id));
  }

  /**
   * Bulk create shifts
   */
  async bulkCreateShifts(inputs: CreateShiftInput[]): Promise<BulkCreateResult> {
    const created: Shift[] = [];
    const failed: { input: CreateShiftInput; error: string }[] = [];

    for (const input of inputs) {
      try {
        const shift = await this.createPlannedShift(input);
        created.push(shift);
      } catch (error) {
        failed.push({
          input,
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    }

    return { created, failed };
  }

  /**
   * Publish shifts
   */
  async publishShifts(shiftIds: string[]): Promise<void> {
    if (shiftIds.length === 0) return;
    
    await db
      .update(plannedShifts)
      .set({
        status: 'PUBLISHED',
        updatedAt: new Date(),
      })
      .where(sql`${plannedShifts.id} IN (${sql.join(shiftIds.map(id => sql`${id}`))})`);
  }

  /**
   * Duplicate shifts to another week
   */
  async duplicateShifts(
    shiftIds: string[],
    options: DuplicateOptions
  ): Promise<Shift[]> {
    if (shiftIds.length === 0) return [];

    const existingShifts = await db.query.plannedShifts.findMany({
      where: sql`${plannedShifts.id} IN (${sql.join(shiftIds.map(id => sql`${id}`))})`,
    });

    // Filter by employee IDs if provided
    const shiftsToDuplicate = options.employeeIds
      ? existingShifts.filter((s) => options.employeeIds?.includes(s.userId))
      : existingShifts;

    if (shiftsToDuplicate.length === 0) return [];

    // Calculate week offset
    const firstShiftDate = parseISO(shiftsToDuplicate[0].shiftDate);
    const sourceWeekStart = startOfWeek(firstShiftDate, { weekStartsOn: 1 });
    const targetWeekStart = startOfWeek(options.targetWeekStart, { weekStartsOn: 1 });
    const weekOffsetDays = differenceInDays(targetWeekStart, sourceWeekStart);

    const newShifts: Shift[] = [];

    for (const existing of shiftsToDuplicate) {
      const existingDate = parseISO(existing.shiftDate);
      const newDate = addWeeks(existingDate, Math.floor(weekOffsetDays / 7));
      const newDateStr = format(newDate, 'yyyy-MM-dd');

      const shiftData: CreateShiftInput = {
        companyId: existing.companyId,
        userId: existing.userId,
        branchId: existing.branchId,
        role: existing.role,
        shiftDate: newDateStr,
        startTime: existing.startTime,
        endTime: existing.endTime,
        notes: existing.notes || undefined,
        status: 'DRAFT',
      };

      try {
        const newShift = await this.createPlannedShift(shiftData);
        newShifts.push(newShift);
      } catch {
        // Skip shifts that couldn't be created (e.g., due to conflicts)
      }
    }

    return newShifts;
  }

  /**
   * Validate a shift against LFT rules and existing shifts
   */
  async validateShift(
    shift: Shift,
    existingShifts: Shift[] = []
  ): Promise<{ isValid: boolean; violations: LFTViolation[] }> {
    const violations: LFTViolation[] = [];

    // Calculate shift duration in minutes
    const startMinutes = this.timeToMinutes(shift.startTime);
    const endMinutes = this.timeToMinutes(shift.endTime);
    const durationMinutes = endMinutes > startMinutes
      ? endMinutes - startMinutes
      : (24 * 60 - startMinutes) + endMinutes; // Handle overnight shifts

    // Check daily hours limit
    if (durationMinutes > PlannedShiftServiceImpl.DAILY_HOURS_LIMIT) {
      violations.push({
        type: 'DAILY_HOURS',
        severity: 'error',
        message: `El turno excede el límite diario de 8 horas (${Math.floor(durationMinutes / 60)}h)`,
        shiftId: shift.id,
      });
    }

    // Check for shift overlaps
    const dayShifts = existingShifts.filter(
      (s) => s.shiftDate === shift.shiftDate && s.status !== 'CANCELLED'
    );

    for (const existing of dayShifts) {
      const existingStart = this.timeToMinutes(existing.startTime);
      const existingEnd = this.timeToMinutes(existing.endTime);

      if (
        (startMinutes < existingEnd && endMinutes > existingStart) ||
        (existingStart < endMinutes && existingEnd > startMinutes)
      ) {
        violations.push({
          type: 'SHIFT_OVERLAP',
          severity: 'error',
          message: `El turno se solapa con otro turno existente`,
          shiftId: shift.id,
        });
        break;
      }
    }

    // Check weekly hours
    const weekStart = startOfWeek(parseISO(shift.shiftDate), { weekStartsOn: 1 });
    const weekShifts = existingShifts.filter(
      (s) => {
        const sWeekStart = startOfWeek(parseISO(s.shiftDate), { weekStartsOn: 1 });
        return sWeekStart.getTime() === weekStart.getTime() && s.status !== 'CANCELLED';
      }
    );

    const weeklyMinutes = weekShifts.reduce((total, s) => {
      const sStart = this.timeToMinutes(s.startTime);
      const sEnd = this.timeToMinutes(s.endTime);
      const sDuration = sEnd > sStart
        ? sEnd - sStart
        : (24 * 60 - sStart) + sEnd;
      return total + sDuration;
    }, durationMinutes);

    if (weeklyMinutes > PlannedShiftServiceImpl.WEEKLY_HOURS_LIMIT) {
      violations.push({
        type: 'WEEKLY_HOURS',
        severity: 'error',
        message: `El empleado excedería el límite semanal de 48 horas`,
        shiftId: shift.id,
      });
    }

    // Check rest period between shifts
    const previousDayShifts = existingShifts.filter(
      (s) => {
        const sDate = parseISO(s.shiftDate);
        const shiftDate = parseISO(shift.shiftDate);
        const diffDays = differenceInDays(shiftDate, sDate);
        return diffDays === 1 && s.status !== 'CANCELLED';
      }
    );

    for (const prevShift of previousDayShifts) {
      const prevEnd = this.timeToMinutes(prevShift.endTime);
      const currentStart = startMinutes;
      
      // Handle overnight shifts
      const restMinutes = prevEnd > currentStart
        ? (24 * 60 - prevEnd) + currentStart
        : currentStart - prevEnd;

      if (restMinutes < PlannedShiftServiceImpl.REST_BETWEEN_SHIFTS) {
        violations.push({
          type: 'REST_PERIOD',
          severity: 'warning',
          message: `El periodo de descanso es menor a 8 horas (${Math.floor(restMinutes / 60)}h)`,
          shiftId: shift.id,
        });
      }
    }

    return {
      isValid: violations.filter(v => v.severity === 'error').length === 0,
      violations,
    };
  }

  /**
   * Convert time string (HH:mm) to minutes from midnight
   */
  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}

// Singleton instance
export const plannedShiftService = new PlannedShiftServiceImpl();
