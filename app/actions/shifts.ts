"use server";

import {
  plannedShiftService,
  shiftValidationService,
  shiftTemplateService,
  DEFAULT_TEMPLATES,
} from "@/lib/services";
import {
  ShiftFilters,
  CreateShiftInput,
  Shift,
  LFTViolation,
  ValidationResult,
  BulkShiftOperation,
  ApplyTemplateResult,
  TemplatePreview,
  ShiftTemplate,
} from "@/lib/types/shifts";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/tenant-context";
import { resolveShiftScope, type ShiftActor } from "@/lib/labor/shift-access";
import { db } from "@/lib/db";
import {
  branches,
  employeeProfiles,
  plannedShifts,
  users,
} from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Identidad del actor, tomada de la sesión y sólo de la sesión.
 *
 * El companyId lo pone `requireAuth()` (que lee `session.user.companyId`); el
 * `branchId` es el de la sesión, no el que llega en el cuerpo de la petición.
 * Antes, estas acciones llamaban al servicio tal cual y `getPlannedShifts`
 * aceptaba filtros vacíos: pedir la lista sin filtros devolvía los turnos de
 * todas las empresas (H01). El guard de rol del componente `ShiftsPage` no
 * cubría nada de esto — un `fetch` a la acción no pasa por el componente.
 */
async function actorDeSesion(): Promise<ShiftActor> {
  const { user } = await requireAuth();
  return {
    userId: user.id,
    role: user.role,
    companyId: user.companyId ?? "",
    branchId: user.branchId ?? null,
  };
}

/**
 * Catálogo que necesita el planificador: sucursales, empleados y roles.
 *
 * `roles` son los puestos que **ya existen en la empresa**: los `position` de
 * los empleados en alcance más los roles que ya usan sus turnos. No es una
 * lista inventada en el componente —que era lo que ofrecía antes— ni un
 * catálogo cerrado: si nadie tiene puesto capturado, la lista sale vacía y el
 * operador lo ve, en vez de elegir un rol que nadie ocupa.
 *
 * `sinAlcance` distingue "no hay nada" de "no tienes sucursal asignada". Las
 * dos listas vacías se ven igual en la pantalla, y una de ellas significa que
 * hay un dato pendiente en la cuenta del usuario.
 */
export interface SchedulerCatalog {
  branches: { id: string; name: string }[];
  employees: {
    id: string;
    name: string;
    position: string | null;
    branchId: string | null;
  }[];
  roles: string[];
  /** `true` cuando el rol está acotado a sucursal y no tiene ninguna asignada. */
  sinAlcance: boolean;
}

/**
 * Sucursales y empleados reales dentro del alcance de la sesión (H03).
 *
 * El contenedor del planificador traía tres arrays ficticios y los pintaba como
 * conteos reales; la matriz los pasaba al editor, que los guardaba contra una
 * escritura de verdad. Con C02 el servidor ya rechaza esos ids, así que la
 * pantalla tenía que dejar de inventarlos.
 *
 * Empresa y alcance salen de `actorDeSesion()`: el navegador no puede ampliar
 * ni desbordar lo que ve.
 */
export async function getSchedulerCatalog(): Promise<SchedulerCatalog> {
  const actor = await actorDeSesion();
  const alcance = resolveShiftScope(actor, null);

  if (alcance.kind === "NONE") {
    return { branches: [], employees: [], roles: [], sinAlcance: true };
  }

  const sucursales = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(
      alcance.kind === "BRANCH"
        ? eq(branches.id, alcance.branchId)
        : eq(branches.companyId, actor.companyId)
    )
    .orderBy(branches.name);

  const empleados = await db
    .select({
      id: users.id,
      name: users.name,
      branchId: users.branchId,
      position: employeeProfiles.position,
      isActive: employeeProfiles.isActive,
    })
    .from(users)
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
    .where(
      and(
        eq(users.companyId, actor.companyId),
        isNull(users.deletedAt),
        alcance.kind === "BRANCH" ? eq(users.branchId, alcance.branchId) : undefined
      )
    )
    .orderBy(users.name);

  // Los roles que la empresa ya usa: los puestos capturados más los que aparecen
  // en sus turnos. Sin esto habría que inventar la lista en el componente, que
  // es justo lo que se vino a corregir.
  const rolesUsados = await db
    .selectDistinct({ role: plannedShifts.role })
    .from(plannedShifts)
    .where(eq(plannedShifts.companyId, actor.companyId));

  const roles = [
    ...new Set(
      [
        ...empleados.map((e) => e.position?.trim() ?? ""),
        ...rolesUsados.map((r) => r.role?.trim() ?? ""),
      ].filter((rol) => rol.length > 0)
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));

  return {
    branches: sucursales,
    employees: empleados.map((e) => ({
      id: e.id,
      name: e.name ?? e.id,
      position: e.position,
      branchId: e.branchId,
    })),
    roles,
    sinAlcance: false,
  };
}

export async function getDefaultTemplates() {
  return DEFAULT_TEMPLATES;
}

export async function getShifts(filters: ShiftFilters = {}): Promise<Shift[]> {
  return plannedShiftService.getPlannedShifts(await actorDeSesion(), filters);
}

export async function createShift(data: CreateShiftInput): Promise<Shift> {
  const result = await plannedShiftService.createPlannedShift(await actorDeSesion(), data);
  revalidatePath("/dashboard/labor/shifts");
  return result;
}

export async function updateShift(
  id: string,
  data: Partial<CreateShiftInput>
): Promise<Shift> {
  const result = await plannedShiftService.updatePlannedShift(await actorDeSesion(), id, data);
  revalidatePath("/dashboard/labor/shifts");
  return result;
}

export async function deleteShift(id: string): Promise<void> {
  await plannedShiftService.deletePlannedShift(await actorDeSesion(), id);
  revalidatePath("/dashboard/labor/shifts");
}

export async function publishShifts(shiftIds: string[]): Promise<void> {
  await plannedShiftService.publishShifts(await actorDeSesion(), shiftIds);
  revalidatePath("/dashboard/labor/shifts");
}

export async function duplicateShifts(
  shiftIds: string[],
  targetWeekStart: Date
): Promise<Shift[]> {
  const result = await plannedShiftService.duplicateShifts(
    await actorDeSesion(),
    shiftIds,
    { targetWeekStart }
  );
  revalidatePath("/dashboard/labor/shifts");
  return result;
}

export async function validateShift(
  shift: Shift,
  existingShifts: Shift[] = []
): Promise<ValidationResult> {
  return shiftValidationService.validateShift(shift, existingShifts);
}

export async function validateShifts(shifts: Shift[]): Promise<ValidationResult> {
  return shiftValidationService.validateShifts(shifts);
}

export async function getTemplatesForBranch(
  branchId: string
): Promise<Omit<ShiftTemplate, "id" | "createdAt" | "updatedAt">[]> {
  return shiftTemplateService.getTemplatesForBranch(branchId);
}

export async function applyBulkOperation(
  operation: BulkShiftOperation
): Promise<ApplyTemplateResult> {
  const result = await shiftTemplateService.applyBulkOperation(await actorDeSesion(), operation);
  revalidatePath("/dashboard/labor/shifts");
  return result;
}

export async function previewBulkOperation(
  operation: BulkShiftOperation
): Promise<TemplatePreview[]> {
  return shiftTemplateService.previewBulkOperation(operation);
}


