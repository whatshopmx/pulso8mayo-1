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

export async function getDefaultTemplates() {
  return DEFAULT_TEMPLATES;
}

export async function getShifts(filters: ShiftFilters = {}): Promise<Shift[]> {
  return plannedShiftService.getPlannedShifts(filters);
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


