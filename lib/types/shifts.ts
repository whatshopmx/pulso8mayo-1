/**
 * Centralized Type Definitions for Shift Scheduler System
 * 
 * This file contains all types related to shift management, scheduling,
 * and LFT (Ley Federal del Trabajo) compliance validation.
 */

/**
 * Represents a planned shift in the scheduling system
 */
export interface Shift {
  id: string
  companyId: string
  userId: string
  userName: string
  userEmail?: string
  branchId: string
  branchName: string
  role: string
  shiftDate: string // YYYY-MM-DD
  startTime: string // HH:mm
  endTime: string // HH:mm
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED'
  notes?: string
  templateId?: string
  createdAt: string
  updatedAt: string
  createdBy?: string
}

/**
 * Template for creating recurring shifts
 */
export interface ShiftTemplate {
  id: string
  name: string
  description?: string
  branchId: string
  role: string
  startTime: string
  endTime: string
  daysOfWeek: number[] // 0-6 (Domingo-Sábado)
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Filter options for querying shifts
 */
export interface ShiftFilters {
  branchId?: string
  employeeId?: string
  role?: string
  startDate?: string
  endDate?: string
  status?: ('DRAFT' | 'PUBLISHED' | 'CANCELLED')[]
  search?: string
}

/**
 * Input for creating a new shift
 *
 * `companyId` es opcional y **no lo manda el cliente**: desde C02 lo escribe el
 * servidor con el de la sesión. Sigue en el tipo porque `Shift` (lo que se
 * devuelve al leer) sí lo tiene, y quitarlo del todo rompería ese contrato.
 */
export interface CreateShiftInput {
  companyId?: string
  userId: string
  branchId: string
  role: string
  shiftDate: string
  startTime: string
  endTime: string
  notes?: string
  status?: 'DRAFT' | 'PUBLISHED'
}

/**
 * Input for updating an existing shift
 */
export interface UpdateShiftInput extends Partial<CreateShiftInput> {
  id: string
}

/**
 * Types of LFT violations that can be detected
 */
export type LFTViolationType = 'DAILY_HOURS' | 'WEEKLY_HOURS' | 'REST_PERIOD' | 'OVERTIME' | 'SHIFT_OVERLAP'

/**
 * Represents a violation of LFT regulations
 */
export interface LFTViolation {
  type: LFTViolationType
  severity: 'warning' | 'error'
  message: string
  shiftId: string
  details?: Record<string, unknown>
}

/**
 * Complete weekly schedule view with shifts and conflicts
 */
export interface WeeklySchedule {
  weekStart: Date
  weekEnd: Date
  shifts: Shift[]
  conflicts: LFTViolation[]
  summary: {
    totalShifts: number
    totalHours: number
    byEmployee: Record<string, { shifts: number; hours: number }>
    byRole: Record<string, { shifts: number; hours: number }>
  }
}

/**
 * Bulk operation for creating multiple shifts
 */
export interface BulkShiftOperation {
  branchId: string
  role: string
  employeeIds: string[]
  startDate: string
  endDate: string
  pattern: 'daily' | 'weekly' | 'custom'
  daysOfWeek?: number[] // For custom pattern
  shiftType: 'MATUTINO' | 'VESPERTINO' | 'NOCTURNO' | 'MIXTO' | 'CUSTOM'
  customStartTime?: string
  customEndTime?: string
}

/**
 * Data format for exporting shifts
 */
export interface ShiftExportData {
  employee: string
  role: string
  date: string
  startTime: string
  endTime: string
  status: string
  notes?: string
}

/**
 * Predefined shift types with their configurations
 */
export const SHIFT_TYPES = {
  MATUTINO: {
    label: 'Matutino',
    start: '07:00',
    end: '15:00',
    color: 'bg-blue-500',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-200'
  },
  VESPERTINO: {
    label: 'Vespertino',
    start: '15:00',
    end: '23:00',
    color: 'bg-orange-500',
    textColor: 'text-orange-700',
    borderColor: 'border-orange-200'
  },
  NOCTURNO: {
    label: 'Nocturno',
    start: '23:00',
    end: '07:00',
    color: 'bg-purple-500',
    textColor: 'text-purple-700',
    borderColor: 'border-purple-200'
  },
  MIXTO: {
    label: 'Mixto',
    start: '10:00',
    end: '18:00',
    color: 'bg-green-500',
    textColor: 'text-green-700',
    borderColor: 'border-green-200'
  }
} as const

export type ShiftTypeKey = keyof typeof SHIFT_TYPES

/**
 * Result of creating shifts in bulk
 */
export interface BulkCreateResult {
  created: Shift[]
  failed: { input: CreateShiftInput; error: string }[]
}

/**
 * Options for duplicating shifts
 */
export interface DuplicateOptions {
  targetWeekStart: Date
  employeeIds?: string[] // Optional: filter by employees
}

/**
 * Result of applying a template
 */
export interface ApplyTemplateResult {
  created: Shift[]
  failed: { date: string; employeeId: string; error: string }[]
}

/**
 * Preview of a template application
 */
export interface TemplatePreview {
  employeeId: string
  branchId: string
  canApply: boolean
  error?: string
  warnings: string[]
  date: string
  startTime: string
  endTime: string
  role: string
  employeeCount: number
}

/**
 * Represents an overlap between two shifts
 */
export interface ShiftOverlap {
  shift1: Shift
  shift2: Shift
  overlapMinutes: number
}

/**
 * Result of validation operations
 */
export interface ValidationResult {
  isValid: boolean
  errors: LFTViolation[]
  warnings: LFTViolation[]
}
