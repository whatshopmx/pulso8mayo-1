/**
 * Extended Shift Service for Planned Shifts CRUD Operations
 * 
 * This module extends the ShiftService with methods for managing planned shifts
 * including filtering, creation, updates, deletion, bulk operations, and duplication.
 */

import { db } from "@/lib/db";
import { plannedShifts, users } from "@/lib/db/schema";
import { eq, and, between, sql, desc } from "drizzle-orm";
import { assertBranchOfCompany } from "@/lib/branch-scope";
import { ApiError } from "@/lib/api/error";
import {
  assertCanAccessShifts,
  assertShiftScopeCoversBranch,
  resolveShiftScope,
  type ShiftActor,
} from "@/lib/labor/shift-access";
import {
  Shift,
  ShiftFilters,
  CreateShiftInput,
  BulkCreateResult,
  DuplicateOptions,
  LFTViolation,
  LFTViolationType,
} from "@/lib/types/shifts";
import { parseISO, startOfWeek, addWeeks, addDays, differenceInDays, format } from "date-fns";
import { evaluarTurno } from "@/lib/labor/shift-rules";

// Extended interface for shift service with planned shifts operations
export interface PlannedShiftService {
  getPlannedShifts(actor: ShiftActor, filters: ShiftFilters): Promise<Shift[]>;
  createPlannedShift(actor: ShiftActor, data: CreateShiftInput): Promise<Shift>;
  updatePlannedShift(actor: ShiftActor, id: string, data: Partial<CreateShiftInput>): Promise<Shift>;
  deletePlannedShift(actor: ShiftActor, id: string): Promise<void>;
  bulkCreateShifts(actor: ShiftActor, inputs: CreateShiftInput[]): Promise<BulkCreateResult>;
  publishShifts(actor: ShiftActor, shiftIds: string[]): Promise<void>;
  duplicateShifts(actor: ShiftActor, shiftIds: string[], options: DuplicateOptions): Promise<Shift[]>;
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
   * Verifica que un empleado pertenezca a la empresa del actor antes de asignarle
   * un turno.
   *
   * `planned_shifts.user_id` es texto contra `users.id` y `users.company_id` es
   * nullable: una fila de turno puede apuntar a un empleado de otra empresa, de
   * una que se borró o de nadie. La llave foránea no lo impide —el empleado
   * existe, sólo que no es tuyo—, así que sin esta comprobación un turno escrito
   * con un `userId` ajeno expone la jornada de otro tenant en este planificador
   * y, al publicar, le manda su turno.
   *
   * El mensaje no distingue "no es tuyo" de "no existe": confirmarle a quien
   * prueba ids qué empleados tienen las demás empresas ya es filtrar. Mismo
   * criterio que `assertBranchOfCompany` (`lib/branch-scope.ts:128`).
   */
  private async assertEmployeeOfCompany(companyId: string, userId: string): Promise<void> {
    const rechazo = () =>
      ApiError.badRequest(
        "El empleado seleccionado no existe para esta empresa. Recarga el catálogo e inténtalo de nuevo."
      );

    if (!userId) throw rechazo();

    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .limit(1);

    if (!row) throw rechazo();
  }

  /**
   * Turnos que la política necesita para juzgar a uno nuevo: el día, la semana
   * y el día anterior. Acotados por empresa y por empleado.
   */
  private async turnosParaValidar(
    companyId: string,
    userId: string,
    shiftDate: string
  ): Promise<Array<{ id: string; userId: string; shiftDate: string; startTime: string; endTime: string; status: string | null }>> {
    const semana = startOfWeek(parseISO(shiftDate), { weekStartsOn: 1 });
    const desde = format(addDays(semana, -1), "yyyy-MM-dd");
    const hasta = format(addDays(semana, 7), "yyyy-MM-dd");

    return db.query.plannedShifts.findMany({
      where: and(
        eq(plannedShifts.companyId, companyId),
        eq(plannedShifts.userId, userId),
        sql`${plannedShifts.shiftDate} >= ${desde}`,
        sql`${plannedShifts.shiftDate} <= ${hasta}`
      ),
      columns: {
        id: true,
        userId: true,
        shiftDate: true,
        startTime: true,
        endTime: true,
        status: true,
      },
    });
  }

  /**
   * Puerta de escritura de un destino: sesión con permiso, sucursal dentro del
   * alcance y sucursal y empleado de esta empresa.
   *
   * Se ejecuta **antes** de cualquier escritura, y también antes del chequeo de
   * solapamiento, para que un rechazo no deje ni una fila ni una lectura
   * lateral de los turnos de otro tenant.
   */
  private async assertDestinoAutorizado(
    actor: ShiftActor,
    destino: { branchId: string; userId: string }
  ): Promise<void> {
    assertCanAccessShifts(actor);

    const alcance = resolveShiftScope(actor, destino.branchId);
    assertShiftScopeCoversBranch(alcance, destino.branchId);

    await assertBranchOfCompany(actor.companyId, destino.branchId);
    await this.assertEmployeeOfCompany(actor.companyId, destino.userId);
  }

  /**
   * Create a planned shift
   *
   * El `companyId` del cuerpo **no se usa**: la fila se escribe con el de la
   * sesión (H01). `CreateShiftInput` lo exige por compatibilidad con el tipo que
   * ya viaja desde el planificador, donde todavía llega vacío — un dato que no
   * se valida ni se persiste no es una entrada.
   */
  async createPlannedShift(actor: ShiftActor, data: CreateShiftInput): Promise<Shift> {
    await this.assertDestinoAutorizado(actor, {
      branchId: data.branchId,
      userId: data.userId,
    });

    // Reglas de negocio con la política compartida (C09).
    //
    // Antes este servicio comparaba cadenas: `data.startTime < existing.endTime`
    // con "07:00" y "9:00" ordena mal porque "9" > "0" en texto. Y sólo miraba
    // el solapamiento del mismo día: la semana, el descanso y los 12 horas los
    // comprobaba la API, que es otro camino de escritura.
    const existentes = await this.turnosParaValidar(
      actor.companyId,
      data.userId,
      data.shiftDate
    );

    const veredicto = evaluarTurno(
      {
        id: `nuevo:${data.userId}:${data.shiftDate}`,
        userId: data.userId,
        shiftDate: data.shiftDate,
        startTime: data.startTime,
        endTime: data.endTime,
        status: "DRAFT",
      },
      existentes
    );

    if (!veredicto.valido) {
      throw ApiError.badRequest(veredicto.errores.map((e) => e.mensaje).join(" "));
    }

    const [shift] = await db
      .insert(plannedShifts)
      .values({
        companyId: actor.companyId,
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
  /**
   * Carga los turnos que el actor puede tocar y falla si alguno no le corresponde.
   *
   * Es la pieza que faltaba en las rutas por ID: `update`, `delete`, `publish` y
   * `duplicate` consultaban **sólo** por `id`, así que con el id de otro turno
   * cualquiera escribía sobre el turno de otra empresa o de otra sucursal (H01).
   *
   * Falla cerrada y en bloque: si de 12 ids uno es ajeno, no se toca ninguno.
   * Publicar la mitad de un lote y dejar la otra mitad parada no es un estado
   * que el operador pueda entender ni corregir desde la pantalla.
   */
  private async cargarTurnosOperables(
    actor: ShiftActor,
    ids: string[]
  ): Promise<Array<{ id: string; branchId: string; userId: string }>> {
    assertCanAccessShifts(actor);

    const alcance = resolveShiftScope(actor, null);
    if (alcance.kind === "NONE") {
      throw ApiError.forbidden(
        "Tu usuario no tiene una sucursal asignada, así que no puede modificar turnos. Pide que te asignen una."
      );
    }

    const turnos = await db.query.plannedShifts.findMany({
      where: and(
        eq(plannedShifts.companyId, actor.companyId),
        sql`${plannedShifts.id} IN (${sql.join(ids.map((id) => sql`${id}`))})`
      ),
    });

    // Cada id debe corresponder a una fila de esta empresa: si sobran ids, los
    // que sobran no son operables por quien pregunta.
    if (turnos.length !== ids.length) {
      throw ApiError.notFound("Alguno de los turnos no existe.");
    }

    for (const turno of turnos) {
      assertShiftScopeCoversBranch(alcance, turno.branchId);
    }

    return turnos.map((turno) => ({
      id: turno.id,
      branchId: turno.branchId,
      userId: turno.userId,
    }));
  }

  /**
   * Update a planned shift
   *
   * El turno debe pertenecer a la empresa del actor y a su alcance. Si la
   * edición mueve el turno a otra sucursal o a otro empleado, ese destino se
   * vuelve a validar con la misma puerta que usa la creación.
   */
  async updatePlannedShift(
    actor: ShiftActor,
    id: string,
    data: Partial<CreateShiftInput>
  ): Promise<Shift> {
    const [turno] = await this.cargarTurnosOperables(actor, [id]);

    if (data.branchId || data.userId) {
      await this.assertDestinoAutorizado(actor, {
        branchId: data.branchId ?? turno.branchId,
        userId: data.userId ?? turno.userId,
      });
    }

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
      .where(and(eq(plannedShifts.id, id), eq(plannedShifts.companyId, actor.companyId)))
      .returning();

    if (!shift) {
      throw ApiError.notFound('Turno no encontrado');
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
  async deletePlannedShift(actor: ShiftActor, id: string): Promise<void> {
    await this.cargarTurnosOperables(actor, [id]);

    // El `company_id` se repite en el WHERE aunque la carga ya lo haya
    // comprobado: si entre la carga y el borrado otra cosa escribiera la misma
    // tabla, el borrado sigue acotado a la empresa de quien preguntó.
    await db
      .delete(plannedShifts)
      .where(and(eq(plannedShifts.id, id), eq(plannedShifts.companyId, actor.companyId)));
  }

  /**
   * Bulk create shifts
   */
  async bulkCreateShifts(actor: ShiftActor, inputs: CreateShiftInput[]): Promise<BulkCreateResult> {
    const created: Shift[] = [];
    const failed: { input: CreateShiftInput; error: string }[] = [];

    for (const input of inputs) {
      try {
        const shift = await this.createPlannedShift(actor, input);
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
   *
   * Publicar es lo que hace que un turno deje de ser un borrador y llegue al
   * empleado, así que es la escritura con más consecuencia del módulo. Valida el
   * lote completo antes de tocar uno solo.
   */
  async publishShifts(actor: ShiftActor, shiftIds: string[]): Promise<void> {
    if (shiftIds.length === 0) return;

    await this.cargarTurnosOperables(actor, shiftIds);

    await db
      .update(plannedShifts)
      .set({
        status: 'PUBLISHED',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(plannedShifts.companyId, actor.companyId),
          sql`${plannedShifts.id} IN (${sql.join(shiftIds.map(id => sql`${id}`))})`
        )
      );
  }

  /**
   * Duplicate shifts to another week
   *
   * Duplicar reescribe `companyId` desde la fila original, así que un turno
   * ajeno crearía un turno de la empresa ajena en el planificador de quien pide.
   * Por eso el lote se carga y se valida con la misma puerta de las demás
   * escrituras, y cada copia vuelve a pasar por `createPlannedShift`.
   */
  async duplicateShifts(
    actor: ShiftActor,
    shiftIds: string[],
    options: DuplicateOptions
  ): Promise<Shift[]> {
    if (shiftIds.length === 0) return [];

    await this.cargarTurnosOperables(actor, shiftIds);

    const existingShifts = await db.query.plannedShifts.findMany({
      where: and(
        eq(plannedShifts.companyId, actor.companyId),
        sql`${plannedShifts.id} IN (${sql.join(shiftIds.map(id => sql`${id}`))})`
      ),
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
        const newShift = await this.createPlannedShift(actor, shiftData);
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
