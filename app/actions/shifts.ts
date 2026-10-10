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
import type { ShiftActor } from "@/lib/labor/shift-access";

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

export async function getDefaultTemplates() {
  return DEFAULT_TEMPLATES;
}

export async function getShifts(filters: ShiftFilters = {}): Promise<Shift[]> {
  return plannedShiftService.getPlannedShifts(await actorDeSesion(), filters);
}

export async function createShift(data: CreateShiftInput): Promise<Shift> {
  const result = await plannedShiftService.createPlannedShift(data);
  revalidatePath("/dashboard/labor/shifts");
  return result;
}

export async function updateShift(
  id: string,
  data: Partial<CreateShiftInput>
): Promise<Shift> {
  const result = await plannedShiftService.updatePlannedShift(id, data);
  revalidatePath("/dashboard/labor/shifts");
  return result;
}

export async function deleteShift(id: string): Promise<void> {
  await plannedShiftService.deletePlannedShift(id);
  revalidatePath("/dashboard/labor/shifts");
}

export async function publishShifts(shiftIds: string[]): Promise<void> {
  await plannedShiftService.publishShifts(shiftIds);
  revalidatePath("/dashboard/labor/shifts");
}

export async function duplicateShifts(
  shiftIds: string[],
  targetWeekStart: Date
): Promise<Shift[]> {
  const result = await plannedShiftService.duplicateShifts(shiftIds, {
    targetWeekStart,
  });
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
  const result = await shiftTemplateService.applyBulkOperation(operation);
  revalidatePath("/dashboard/labor/shifts");
  return result;
}

export async function previewBulkOperation(
  operation: BulkShiftOperation
): Promise<TemplatePreview[]> {
  return shiftTemplateService.previewBulkOperation(operation);
}


