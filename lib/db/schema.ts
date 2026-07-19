/**
 * @deprecated This file is being modularized. Import from lib/db/schema/index.ts instead.
 * This file is kept for backward compatibility during migration.
 * All tables will be moved to domain-specific modules in lib/db/schema/
 */

import { pgTable, text, timestamp, boolean, uuid, jsonb, integer, uniqueIndex, foreignKey, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Import auth tables and enums for internal use within this file
import { account, users, session, sessions, verifications, magicLinks, roleEnum } from './schema/auth';

// Import core tables for foreign key references
import { companies, branches } from './schema/core';

// Re-export modular schema
export * from './schema/index';

// Enums
export const shiftTypeEnum = pgEnum("shift_type", ['MATUTINO', 'VESPERTINO', 'NOCTURNO', 'MIXTO']);
export const dayOfWeekEnum = pgEnum("day_of_week", ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);
// roleEnum is re-exported from auth.ts via schema/index.ts
export const incidentSeverityEnum = pgEnum("incident_severity", ['CRITICAL', 'WARNING', 'FATAL']);
export const incidentStatusEnum = pgEnum("incident_status", ['DETECTED', 'IN_REMEDIATION', 'RESOLVED', 'ESCALATED']);

// Workflow Scheduling Enums
export const scheduleFrequencyEnum = pgEnum("schedule_frequency", ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE']);
export const assignmentTypeEnum = pgEnum("assignment_type", ['ROLE', 'USER', 'AUTO', 'MANUAL']);
export const assignmentStatusEnum = pgEnum("assignment_status", ['PENDING', 'NOTIFIED', 'STARTED', 'COMPLETED', 'OVERDUE']);
export const priorityEnum = pgEnum("priority", ['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const notificationTypeEnum = pgEnum("notification_type", ['info', 'warning', 'error', 'success']);

// Note: account, users, sessions, verifications, magicLinks tables are re-exported from auth.ts
// Keeping them here would cause duplicate identifier errors

// Note: companies, branches, holidays tables are re-exported from core.ts
// These were migrated to lib/db/schema/core.ts

export const breakLogs = pgTable("break_logs", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    sessionId: uuid("session_id").notNull(),
    startTime: timestamp("start_time").defaultNow().notNull(),
    endTime: timestamp("end_time"),
    durationMinutes: integer("duration_minutes"),
    type: text("type").default('STANDARD'), // STANDARD, MEAL, REST, EMERGENCY
    isCompliant: boolean("is_compliant").default(true), // Whether break meets legal requirements
    complianceNotes: text("compliance_notes"), // Notes about compliance issues
    remindedAt: timestamp("reminded_at"), // When break reminder was sent
});

export const workflowInstances = pgTable("workflow_instances", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    workflowTemplateId: text("workflow_template_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    assigneeId: text("assignee_id"), // User ID or null
    sessionId: uuid("session_id"), // Shift Session ID
    scheduleId: uuid("schedule_id"), // FK to workflow_schedules
    assignmentId: uuid("assignment_id"), // FK to workflow_assignments
    status: text("status").default('PENDING'), // PENDING, IN_PROGRESS, COMPLETED, BLOCKED
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    dueDate: timestamp("due_date"),
    priority: priorityEnum("priority").default('MEDIUM'),
    currentStepId: text("current_step_id"),
    data: jsonb("data").default(sql`'{}'::jsonb`), // Store full form state if needed
    score: integer("score"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export const workflowInstanceSteps = pgTable("workflow_instance_steps", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    instanceId: uuid("instance_id").notNull(),
    stepId: text("step_id").notNull(), // Links to step in JSON template
    status: text("status").default('PENDING'), // PENDING, COMPLETED, FAILED, SKIPPED
    value: jsonb("value"), // The input value (text, number, photo URL)
    aiAnalysis: jsonb("ai_analysis"), // The result from AI verification
    evidenceUrl: text("evidence_url"), // Photo/Video proof
    comment: text("comment"),
    completedAt: timestamp("completed_at"),
    completedBy: text("completed_by"), // User ID
});

export const workflowTemplates = pgTable("workflow_templates", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id"), // Optional, if template is branch-specific
    name: text("name"),
    description: text("description"),
    steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`), // Stores the form builder elements
    category: text("category").default('GENERAL'),

    // Compliance Metadata
    complianceType: text("compliance_type"), // 'NOM-251', 'NOM-035', 'LABOR'
    regulationSection: text("regulation_section"),
    requiredFrequency: text("required_frequency"), // 'DAILY', 'WEEKLY'
    isCritical: boolean("is_critical").default(false),

  active: boolean("active").default(true),

  // Legacy columns (preserved from older schema versions)
  jsonSchema: jsonb("json_schema"), // Legacy
  originalTemplateId: text("original_template_id"), // Legacy
  title: text("title"), // Legacy
  isCustom: boolean("is_custom").default(false), // Legacy

  // Advanced Configuration (per TEMPLATE_SCHEMA.md)
  version: integer("version").default(1),
  duracionEstimada: text("duracion_estimada"),
  tags: jsonb("tags").default(sql`'[]'::jsonb`),
  aiConfig: jsonb("ai_config"),
  complianceConfig: jsonb("compliance_config"),
  completionActions: jsonb("completion_actions").default(sql`'[]'::jsonb`),

  // Reminder configuration - intervals in minutes before due date
  // Default: [1440, 60, 30] = 24h, 1h, 30min
  reminderIntervals: jsonb("reminder_intervals").default(sql`'[1440, 60, 30]'::jsonb`),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const workflowSchedules = pgTable("workflow_schedules", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    templateId: text("template_id").notNull(),
    branchId: uuid("branch_id").notNull(),

    // Assignment Configuration
    assignmentType: assignmentTypeEnum("assignment_type").notNull().default('AUTO'),
    assignedRole: roleEnum("assigned_role"), // 'GERENTE', 'SUPERVISOR', 'EMPLEADO'
    assignedUserId: text("assigned_user_id"), // Specific user ID

    // Scheduling Configuration
    frequency: scheduleFrequencyEnum("frequency").notNull(),
    dayOfWeek: integer("day_of_week"), // 0-6 (Sunday-Saturday) for WEEKLY
    dayOfMonth: integer("day_of_month"), // 1-31 for MONTHLY
    timeOfDay: text("time_of_day"), // HH:MM format (e.g., "08:00")

    // Recurrence Settings
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date"), // null = indefinite
    isActive: boolean("is_active").default(true),

    // Metadata
    title: text("title").notNull(),
    description: text("description"),
    priority: priorityEnum("priority").default('MEDIUM'),

    // Tracking
    lastExecutedAt: timestamp("last_executed_at"),
    nextExecutionAt: timestamp("next_execution_at"),
    executionCount: integer("execution_count").default(0),

    // Audit
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export const eventTriggers = pgTable("event_triggers", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    templateId: text("template_id").notNull(),
    branchId: uuid("branch_id").notNull(),

    // Trigger Configuration
    eventName: text("event_name").notNull(), // 'INVENTORY_LOW', 'SHIFT_ENDED'
    conditions: jsonb("conditions"), // Configuration for the event

    isActive: boolean("is_active").default(true),

    // Audit
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export const workflowAssignments = pgTable("workflow_assignments", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    instanceId: uuid("instance_id").notNull(), // FK to workflow_instances
    scheduleId: uuid("schedule_id"), // FK to workflow_schedules (null if manual)

    assignedTo: text("assigned_to").notNull(), // User ID
    assignedBy: text("assigned_by"), // User ID who assigned (null if auto)
    assignmentType: assignmentTypeEnum("assignment_type").notNull(),

    // Status
    status: assignmentStatusEnum("status").default('PENDING'),
    notifiedAt: timestamp("notified_at"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),

    // Due Date
    dueDate: timestamp("due_date"),
    isOverdue: boolean("is_overdue").default(false),

  // Metadata
  priority: priorityEnum("priority").default('MEDIUM'),
  notes: text("notes"),

  // Reminder tracking for staggered reminders (24h, 1h, 30min)
  remindersSent: jsonb("reminders_sent").default(sql`'[]'::jsonb`), // Array of {type: '24h'|'1h'|'30min', sentAt: ISO string}

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const incidents = pgTable("incidents", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    instanceId: uuid("instance_id").notNull(), // Workflow instance ID
    stepId: text("step_id").notNull(),
    branchId: uuid("branch_id").notNull(), // Branch where incident occurred
    severity: incidentSeverityEnum("severity").notNull(),
    status: incidentStatusEnum("status").default('DETECTED'),
    title: text("title").notNull(),
    description: text("description"),
    detectedBy: text("detected_by"), // User ID who triggered the incident
    initialValue: jsonb("initial_value"),
    targetValue: jsonb("target_value"),
    photoUrl: text("photo_url"),
    metadata: jsonb("metadata"), // Additional context (rule, conditions, etc.)
    remediationProtocol: jsonb("remediation_protocol"), // Self-fix steps
    escalationChain: jsonb("escalation_chain"), // Escalation levels
    currentAttempt: integer("current_attempt").default(0),
    maxAttempts: integer("max_attempts").default(1),
    resolution: text("resolution"), // Resolution notes
    resolvedBy: text("resolved_by"), // User ID who resolved
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

// Note: magicLinks, users, sessions, verifications tables re-exported from auth.ts

// Plantillas de turnos recurrentes
export const shiftTemplates = pgTable("shift_templates", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    name: text("name").notNull(),                    // "Turno Mañana Cocina"
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id"),                      // null = toda la empresa
    
    // Configuración del turno
    role: text("role").notNull(),                     // "COCINERO"
    startTime: text("start_time").notNull(),          // "07:00"
    endTime: text("end_time").notNull(),              // "15:00"
    
    // Días de la semana (array de enteros: 0=domingo, 1=lunes, ..., 6=sábado)
    daysOfWeek: integer("days_of_week").array(),      // [1, 3, 5] = Lun, Mié, Vie
    
    // Vigencia de la plantilla
    validFrom: text("valid_from").notNull(),          // "2026-03-17"
    validUntil: text("valid_until"),                  // null = indefinido
    
    // Metadata
    createdBy: text("created_by").notNull(),
    isActive: boolean("is_active").default(true),
    
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

// Turnos planificados (instancias concretas para fechas específicas)
export const plannedShifts = pgTable("planned_shifts", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    userId: text("user_id").notNull(),
    branchId: uuid("branch_id").notNull(),

    // Fecha específica del turno
    shiftDate: text("shift_date").notNull(),          // "2026-03-17"
    startTime: text("start_time").notNull(),          // "07:00"
    endTime: text("end_time").notNull(),              // "15:00"

    // Origen del turno
    templateId: uuid("template_id"),                  // null = creado manualmente
    workflowTemplateId: text("workflow_template_id"), // Workflow asociado al turno (FK a workflow_templates.id)
    role: text("role").notNull(),

    // Estado
    status: text("status").default("DRAFT"),          // DRAFT, PUBLISHED, CANCELLED
    notes: text("notes"),

    // Auditoría
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
    // Índice único para prevenir turnos duplicados para el mismo usuario en la misma fecha/hora
    uniqueShift: uniqueIndex("unique_shift").on(
        table.userId,
        table.shiftDate,
        table.startTime
    ),
}));

// Legacy: Shift assignments (preserved from older schema version)
export const shiftAssignments = pgTable("shift_assignments", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    dayOfWeek: integer("day_of_week"),
    specificDate: text("specific_date"),
    shiftName: text("shift_name"),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
});

// Legacy: Schedule configs (preserved from older schema version)
export const scheduleConfigs = pgTable("schedule_configs", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    branchId: uuid("branch_id").notNull(),
    templateId: text("template_id").notNull(),
    cronExpression: text("cron_expression").notNull(),
    targetRoles: text("target_roles").array().notNull(),
    enabled: boolean("enabled").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

// Sesiones reales de trabajo (cuando el empleado hace check-in/out)
export const shiftSessions = pgTable("shift_sessions", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    plannedShiftId: uuid("planned_shift_id"),         // Referencia al turno planificado
    userId: text("user_id").notNull(),
    branchId: uuid("branch_id").notNull(),

    // Estado de la sesión
    status: text("status").default("PENDING"),        // PENDING, ACTIVE, COMPLETED, NO_SHOW, CANCELLED

    // Tiempos reales
    scheduledStartTime: text("scheduled_start_time"), // "07:00" - hora planificada
    scheduledEndTime: text("scheduled_end_time"),     // "15:00" - hora planificada
    checkInTime: timestamp("check_in_time"),          // Timestamp real del check-in
    checkOutTime: timestamp("check_out_time"),        // Timestamp real del check-out

    // Tiempo trabajado
    totalBreakMinutes: integer("total_break_minutes").default(0),
    totalWorkMinutes: integer("total_work_minutes").default(0),
    overtimeMinutes: integer("overtime_minutes").default(0),

    // Geolocalización del check-in/out
    checkInGeolocation: jsonb("check_in_geolocation"), // { latitude, longitude, accuracy, timestamp }
    checkOutGeolocation: jsonb("check_out_geolocation"),

    // Banderas de cumplimiento
    complianceFlags: jsonb("compliance_flags"),       // { lateCheckIn: true, earlyCheckOut: false, missedBreak: false }
    
    // Discrepancias y aprobaciones
    lateMinutes: integer("late_minutes").default(0),  // Minutos de retraso
    earlyDepartureMinutes: integer("early_departure_minutes").default(0), // Minutos de salida temprana
    requiresApproval: boolean("requires_approval").default(false), // Si requiere aprobación del manager
    approvedBy: text("approved_by"),                   // User ID del manager que aprobó
    approvedAt: timestamp("approved_at"),              // Cuando fue aprobado
    rejectionReason: text("rejection_reason"),         // Razón del rechazo
    breakReminderSent: boolean("break_reminder_sent").default(false), // Si se envió recordatorio de break

    notes: text("notes"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
});

// Shift Change Requests (Intercambio de turnos entre empleados)
export const shiftChangeRequestStatusEnum = pgEnum("shift_change_request_status", ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);

export const shiftChangeRequests = pgTable("shift_change_requests", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id").notNull(),

    // Request details
    requestedBy: text("requested_by").notNull(), // User ID who initiated the request
    requestedShiftId: uuid("requested_shift_id").notNull(), // FK to planned_shifts (the shift they want to give away)
    targetShiftId: uuid("target_shift_id"), // FK to planned_shifts (the shift they want in return, null if just giving away)

    // Counterparty
    counterpartyId: text("counterparty_id").notNull(), // User ID of the other employee
    counterpartyShiftId: uuid("counterparty_shift_id"), // FK to planned_shifts (shift being swapped)

    // Reason and notes
    reason: text("reason").notNull(),
    notes: text("notes"),

    // Approval chain
    status: shiftChangeRequestStatusEnum("status").default('PENDING').notNull(),
    approvedBy: text("approved_by"), // Manager who approved
    approvedAt: timestamp("approved_at"),
    rejectedBy: text("rejected_by"), // Manager who rejected
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),

    // Counterparty response
    counterpartyAccepted: boolean("counterparty_accepted"), // null = not responded yet
    counterpartyResponseAt: timestamp("counterparty_response_at"),

    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Documents (Expediente Laboral)
export const documentTypeEnum = pgEnum("document_type", [
    'CONTRACT', 'ID', 'PROOF_OF_ADDRESS', 'TAX_ID', 'BANK_INFO',
    'CERTIFICATE', 'TRAINING', 'MEDICAL_EXAM', 'PERMIT', 'OTHER'
]);
export const documentStatusEnum = pgEnum("document_status", ['PENDING', 'VALIDATED', 'EXPIRED', 'REJECTED']);

export const employeeDocuments = pgTable("employee_documents", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull(),
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id"),

    // Document details
    documentType: documentTypeEnum("document_type").notNull(),
    documentName: text("document_name").notNull(),
    documentUrl: text("document_url").notNull(), // Cloudflare R2 or S3 URL
    fileKey: text("file_key"), // Storage key for deletion
    
    // Metadata
    fileSize: integer("file_size"), // In bytes
    mimeType: text("mime_type"),
    uploadedBy: text("uploaded_by").notNull(), // User ID who uploaded

    // Validity tracking
    issueDate: timestamp("issue_date"),
    expirationDate: timestamp("expiration_date"), // null = no expiration
    isValid: boolean("is_valid").default(true),

    // Validation
    status: documentStatusEnum("status").default('PENDING').notNull(),
    validatedBy: text("validated_by"), // User ID who validated
    validatedAt: timestamp("validated_at"),
    rejectionReason: text("rejection_reason"),
    notes: text("notes"),

    // Compliance tracking
    isRequired: boolean("is_required").default(false), // If this document is mandatory
    complianceNotes: text("compliance_notes"), // Notes for audits

    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Shift Approvals (for overtime, schedule changes, etc.)
export const shiftApprovalTypeEnum = pgEnum("shift_approval_type", [
    'OVERTIME', 'SCHEDULE_CHANGE', 'TIME_OFF', 'SHIFT_SWAP', 'EARLY_DEPARTURE'
]);
export const shiftApprovalStatusEnum = pgEnum("shift_approval_status", ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);

export const shiftApprovals = pgTable("shift_approvals", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id").notNull(),

    // Approval details
    approvalType: shiftApprovalTypeEnum("approval_type").notNull(),
    requestedBy: text("requested_by").notNull(), // User ID requesting approval
    requestedFor: text("requested_for").notNull(), // User ID the approval is for (employee)
    
    // Related entities
    shiftSessionId: uuid("shift_session_id"), // FK to shift_sessions
    plannedShiftId: uuid("planned_shift_id"), // FK to planned_shifts
    
    // Request details
    title: text("title").notNull(),
    description: text("description"),
    reason: text("reason"),
    
    // Time/details being approved
    startTime: timestamp("start_time"),
    endTime: timestamp("end_time"),
    durationMinutes: integer("duration_minutes"),
    overtimeMinutes: integer("overtime_minutes"),
    extraData: jsonb("extra_data"), // Additional context
    
    // Approval workflow
    status: shiftApprovalStatusEnum("status").default('PENDING').notNull(),
    approvedBy: text("approved_by"), // Manager who approved/rejected
    approvedAt: timestamp("approved_at"),
    rejectionReason: text("rejection_reason"),
    
    // Notifications
    notifiedAt: timestamp("notified_at"),
    reminderSent: boolean("reminder_sent").default(false),
    
    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Inventory System Definitions

// Break Compliance Rules (for Mexican labor law)
export const breakComplianceRules = pgTable("break_compliance_rules", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    
    // Rule configuration
    ruleName: text("rule_name").notNull(),
    description: text("description"),
    
    // Break requirements
    minBreakDuration: integer("min_break_duration").default(30), // Minimum break in minutes
    maxContinuousWork: integer("max_continuous_work").default(300), // Max work before break (in minutes)
    mealBreakRequired: boolean("meal_break_required").default(true), // If meal break is mandatory
    mealBreakMinDuration: integer("meal_break_min_duration").default(30), // Meal break minimum duration
    
    // Work hours limits
    maxDailyHours: integer("max_daily_hours").default(8),
    maxWeeklyHours: integer("max_weekly_hours").default(48),
    minRestBetweenShifts: integer("min_rest_between_shifts").default(12), // Hours between shifts
    
    // Tolerance settings
    lateTolerance: integer("late_tolerance").default(10), // Minutes of tolerance for late arrivals
    earlyDepartureTolerance: integer("early_departure_tolerance").default(10), // Minutes tolerance for early departure
    
    // Alerts
    enableBreakReminders: boolean("enable_break_reminders").default(true),
    reminderInterval: integer("reminder_interval").default(120), // Remind every X minutes
    enableOvertimeAlerts: boolean("enable_overtime_alerts").default(true),
    overtimeAlertThreshold: integer("overtime_alert_threshold").default(30), // Alert after X minutes overtime
    
    // Status
    isActive: boolean("is_active").default(true),
    
    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Break Reminders Log
export const breakReminderLogs = pgTable("break_reminder_logs", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    sessionId: uuid("session_id").notNull(), // FK to shift_sessions
    userId: text("user_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    
    // Reminder details
    reminderType: text("reminder_type").notNull(), // BREAK_DUE, BREAK_OVERDUE, MEAL_BREAK
    message: text("message").notNull(),
    channel: text("channel").notNull(), // WHATSAPP, IN_APP, EMAIL
    
    // Timing
    triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
    sentAt: timestamp("sent_at"),
    
    // Response
    acknowledged: boolean("acknowledged").default(false),
    acknowledgedAt: timestamp("acknowledged_at"),
    
    // Metadata
    metadata: jsonb("metadata"),
});


export const inventoryTransactionTypeEnum = pgEnum("inventory_transaction_type", ['RECEIVING', 'USAGE', 'ADJUSTMENT', 'TRANSFER', 'WASTE', 'RETURN']);
export const inventoryBatchStatusEnum = pgEnum("inventory_batch_status", ['AVAILABLE', 'RESERVED', 'EXPIRED', 'QUARANTINED', 'DEPLETED']);
export const inventoryTransferStatusEnum = pgEnum("inventory_transfer_status", ['PENDING', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED']);

export const suppliers = pgTable("suppliers", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    taxId: text("tax_id"),
    active: boolean("active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export const inventoryItems = pgTable("inventory_items", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    name: text("name").notNull(),
    sku: text("sku"),
    barcode: text("barcode"),
    category: text("category"),
    unit: text("unit").notNull().default('UNIT'), // e.g., KG, L, UNIT, BOX
    minLevel: integer("min_level").default(0),
    maxLevel: integer("max_level"),
    storageArea: text("storage_area"),
    allergenInfo: text("allergen_info"),
    storageRequirements: text("storage_requirements"), // Temp/Humidity text
    typicalShelfLifeDays: integer("typical_shelf_life_days"),
    active: boolean("active").default(true),

    // New fields for Supplier and Pricing
    supplierId: uuid("supplier_id"), // Preferred Supplier
    lastCost: integer("last_cost"), // Unit cost in cents/decimals

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export const inventoryPriceHistory = pgTable("inventory_price_history", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    itemId: uuid("item_id").notNull(),
    previousCost: integer("previous_cost"),
    newCost: integer("new_cost").notNull(),
    supplierId: uuid("supplier_id"), // Optional: if price change is linked to a specific supplier offer
    changedBy: text("changed_by").notNull(), // User ID
    changedAt: timestamp("changed_at").defaultNow().notNull(),
});

export const inventoryBatches = pgTable("inventory_batches", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    itemId: uuid("item_id").notNull(), // References inventoryItems.id
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id"),
    lotNumber: text("lot_number"),
    productionDate: timestamp("production_date"),
    expirationDate: timestamp("expiration_date"),
    receivedAt: timestamp("received_at").defaultNow(),
    initialQuantity: integer("initial_quantity").notNull(),
    currentQuantity: integer("current_quantity").notNull(),
    unitCost: integer("unit_cost"), // Cost per unit for this specific batch
    status: inventoryBatchStatusEnum("status").default('AVAILABLE'),
    supplierBatchInfo: jsonb("supplier_batch_info"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export const inventoryMovements = pgTable("inventory_movements", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    branchId: uuid("branch_id").notNull(),
    itemId: uuid("item_id").notNull(),
    batchId: uuid("batch_id"), // Optional, if tracking by batch
    type: inventoryTransactionTypeEnum("type").notNull(),
    quantityChange: integer("quantity_change").notNull(), // Positive or negative
    reason: text("reason"),
    referenceId: text("reference_id"), // Could be workflow instance ID or order ID
    performedBy: text("performed_by"), // User ID
    timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// Temperature Monitoring Logs
export const temperatureLogs = pgTable("temperature_logs", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  branchId: uuid("branch_id").notNull(),
  equipmentId: uuid("equipment_id"),
  workflowInstanceId: uuid("workflow_instance_id"),
  readingValue: integer("reading_value").notNull(),
  unit: text("unit").default('C'),
  location: text("location"),
  isCompliant: boolean("is_compliant").default(true),
  minThreshold: integer("min_threshold"),
  maxThreshold: integer("max_threshold"),
  capturedBy: uuid("captured_by"),
  captureMethod: text("capture_method").default('MANUAL'),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Cost Tracking Records
export const costRecords = pgTable("cost_records", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull(),
  branchId: uuid("branch_id"),
  category: text("category").notNull(),
  amount: integer("amount").notNull(),
  description: text("description"),
  referenceId: text("reference_id"),
  recordedBy: uuid("recorded_by"),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Inventory Transfers between branches
export const inventoryTransfers = pgTable("inventory_transfers", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    transferNumber: text("transfer_number").notNull().unique(), // e.g., TRF-2024-001
    
    // Origin and destination branches
    fromBranchId: uuid("from_branch_id").notNull(),
    toBranchId: uuid("to_branch_id").notNull(),
    
    // Status tracking
    status: inventoryTransferStatusEnum("status").default('PENDING').notNull(),
    
    // Request details
    requestedBy: text("requested_by").notNull(), // User ID who requested
    approvedBy: text("approved_by"), // User ID who approved
    shippedBy: text("shipped_by"), // User ID who shipped
    receivedBy: text("received_by"), // User ID who received
    
    // Timestamps
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    approvedAt: timestamp("approved_at"),
    shippedAt: timestamp("shipped_at"),
    receivedAt: timestamp("received_at"),
    cancelledAt: timestamp("cancelled_at"),
    
    // Additional info
    notes: text("notes"),
    rejectionReason: text("rejection_reason"),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Transfer line items
export const inventoryTransferItems = pgTable("inventory_transfer_items", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    transferId: uuid("transfer_id").notNull(), // References inventoryTransfers.id
    
    // Item details
    itemId: uuid("item_id").notNull(),
    batchId: uuid("batch_id"), // Specific batch being transferred
    
    // Quantities
    requestedQuantity: integer("requested_quantity").notNull(),
    approvedQuantity: integer("approved_quantity"), // May approve less than requested
    shippedQuantity: integer("shipped_quantity"),
    receivedQuantity: integer("received_quantity"),
    
    // Additional info
    notes: text("notes"),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relationships/Foreign Keys (Defined implicitly via standard Drizzle references if needed,
// but often standard FK constraints are enough in 'foreignKeys' object, or inline 'references')

// Notifications table
export const notifications = pgTable("notifications", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    type: notificationTypeEnum("type").notNull(),
    actionUrl: text("action_url"),
    actionLabel: text("action_label"),
    read: boolean("read").notNull().default(false),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Notification Preferences table
export const notificationPreferences = pgTable("notification_preferences", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().unique(),

    // Channel preferences
    whatsappEnabled: boolean("whatsapp_enabled").notNull().default(true),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    inAppEnabled: boolean("in_app_enabled").notNull().default(true),

    // Event preferences
    workflowAssignments: boolean("workflow_assignments").notNull().default(true),
    workflowDueSoon: boolean("workflow_due_soon").notNull().default(true),
    workflowOverdue: boolean("workflow_overdue").notNull().default(true),
    incidents: boolean("incidents").notNull().default(true),
    inventoryAlerts: boolean("inventory_alerts").notNull().default(true),

    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Inventory Alerts table
export const inventoryAlertStatusEnum = pgEnum("inventory_alert_status", ['ACTIVE', 'VIEWED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED']);
export const inventoryAlertTypeEnum = pgEnum("inventory_alert_type", ['LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING_SOON', 'EXPIRED']);
export const inventoryWasteReasonEnum = pgEnum("inventory_waste_reason", ['EXPIRED', 'DAMAGED', 'QUALITY', 'SPILLAGE', 'OTHER']);

export const inventoryAlerts = pgTable("inventory_alerts", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id),

    // Alert details
    type: inventoryAlertTypeEnum("type").notNull(),
    severity: text("severity").notNull(), // BAJA, MEDIA, ALTA, CRITICA
    status: inventoryAlertStatusEnum("status").notNull().default('ACTIVE'),

    // Stock snapshot at detection time
    currentStock: integer("current_stock").notNull(),
    minLevel: integer("min_level").notNull(),
    batchId: uuid("batch_id"), // Reference to specific batch if applicable

    // Timestamps
    detectedAt: timestamp("detected_at").notNull().defaultNow(),
    viewedAt: timestamp("viewed_at"),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by"), // User ID

    // Notes
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Inventory Waste Tracking table
export const inventoryWaste = pgTable("inventory_waste", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    batchId: uuid("batch_id").references(() => inventoryBatches.id),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id),

    // Waste details
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    reason: inventoryWasteReasonEnum("reason").notNull(),
    costPerUnit: integer("cost_per_unit"), // In cents
    totalLoss: integer("total_loss"), // In cents

    // Audit
    recordedBy: text("recorded_by").notNull(), // User ID
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

// WhatsApp Sessions table
export const whatsappSessionStatusEnum = pgEnum("whatsapp_session_status", ['DISCONNECTED', 'CONNECTING', 'CONNECTED', 'FAILED']);

export const whatsappSessions = pgTable("whatsapp_sessions", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id),

    // WhatsApp session info
    sessionId: text("session_id").notNull().unique(), // External session ID from WhatsApp API
    phoneNumber: text("phone_number"), // Connected WhatsApp number

    // Status
    status: whatsappSessionStatusEnum("status").default('DISCONNECTED').notNull(),
    qrCode: text("qr_code"), // Base64 QR code for scanning
    qrCodeExpiresAt: timestamp("qr_code_expires_at"),

    // Connection metadata
    connectedAt: timestamp("connected_at"),
    lastActivityAt: timestamp("last_activity_at"),
    disconnectedAt: timestamp("disconnected_at"),

    // Configuration
    webhookUrl: text("webhook_url"),
    isActive: boolean("is_active").default(true),

    // Error tracking
    lastError: text("last_error"),
    errorCount: integer("error_count").default(0),

    // Audit
    createdBy: text("created_by").notNull(), // User ID who set up
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// WhatsApp Message Log (for debugging and analytics)
export const whatsappConversationStatusEnum = pgEnum("whatsapp_conversation_status", ['ACTIVE', 'WAITING_EVIDENCE', 'COMPLETED', 'TIMEOUT', 'CANCELLED']);

export const whatsappConversationStates = pgTable("whatsapp_conversation_states", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userPhone: text("user_phone").notNull(),
    userId: text("user_id").references(() => users.id),

    // Workflow context
    workflowInstanceId: uuid("workflow_instance_id").references(() => workflowInstances.id),
    currentStepId: uuid("current_step_id"),
    stepIndex: integer("step_index"),

    // State
    status: whatsappConversationStatusEnum("status").notNull().default('ACTIVE'),
    lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),

    // Metadata
    context: jsonb("context").default('{}'),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const whatsappMessages = pgTable("whatsapp_messages", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    sessionId: uuid("session_id").notNull().references(() => whatsappSessions.id),

    // Message details
    direction: text("direction").notNull(), // 'INBOUND' | 'OUTBOUND'
    from: text("from").notNull(), // Phone number
    to: text("to").notNull(), // Phone number
    messageType: text("message_type").notNull(), // 'text' | 'image' | 'document' | etc
    content: text("content"), // Message text
    mediaUrl: text("media_url"), // If media message

    // Processing
    command: text("command"), // Parsed command if applicable
    processed: boolean("processed").default(false),
    processingError: text("processing_error"),

    // Status tracking
    status: text("status").default('pending'), // 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
    updatedAt: timestamp("updated_at").defaultNow(),

    // Metadata
    externalMessageId: text("external_message_id"), // External WhatsApp message ID
    timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// KPI System Definitions
export const kpiMetricTypeEnum = pgEnum("kpi_metric_type", ['PERCENTAGE', 'COUNT', 'AVERAGE', 'SUM', 'TIME', 'RATIO']);
export const kpiFrequencyEnum = pgEnum("kpi_frequency", ['REALTIME', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']);
export const kpiThresholdTypeEnum = pgEnum("kpi_threshold_type", ['MIN', 'MAX', 'TARGET', 'RANGE']);
export const kpiAlertStatusEnum = pgEnum("kpi_alert_status", ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE']);

// KPI Definitions Table
export const kpiDefinitions = pgTable("kpi_definitions", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id"), // null = company-wide KPI
    
    // KPI Configuration
    name: text("name").notNull(),
    description: text("description"),
    formula: text("formula").notNull(), // Expression formula (e.g., "completed_workflows / total_workflows * 100")
    metricType: kpiMetricTypeEnum("metric_type").notNull(), // PERCENTAGE, COUNT, AVERAGE, etc.
    
    // Target and Thresholds
    target: integer("target"), // Target value (for percentage: 0-100, for count: absolute number)
    warningThreshold: integer("warning_threshold"), // Yellow alert threshold
    criticalThreshold: integer("critical_threshold"), // Red alert threshold
    thresholdType: kpiThresholdTypeEnum("threshold_type").default('TARGET'), // MIN, MAX, TARGET, RANGE
    
    // Calculation Settings
    frequency: kpiFrequencyEnum("frequency").notNull().default('DAILY'), // How often to calculate
    dataRetentionDays: integer("data_retention_days").default(90), // How long to keep historical data
    
    // Display Settings
    unit: text("unit").default(''), // e.g., '%', 'hrs', 'units'
    decimalPlaces: integer("decimal_places").default(2),
    category: text("category").default('OPERATIONS'), // OPERATIONS, COMPLIANCE, LABOR, INVENTORY
    
    // Status
    active: boolean("active").default(true),
    isSystem: boolean("is_system").default(false), // System KPIs cannot be deleted
    
    // Audit
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// KPI Historical Values Table
export const kpiHistory = pgTable("kpi_history", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    kpiId: uuid("kpi_id").notNull().references(() => kpiDefinitions.id),
    branchId: uuid("branch_id"), // Denormalized for easier querying
    
    // Value
    value: integer("value").notNull(), // Stored as integer (e.g., 85.50 = 8550 for percentages)
    rawValue: text("raw_value"), // Optional: store raw calculation data
    
    // Period
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    
    // Status at calculation time
    status: text("status").default('NORMAL'), // NORMAL, WARNING, CRITICAL
    target: integer("target"), // Snapshot of target at calculation time
    targetAchieved: boolean("target_achieved"),
    
    // Metadata
    calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
    metadata: jsonb("metadata"), // Additional context (e.g., { totalWorkflows: 100, completed: 85 })
});

// KPI Alerts Table
export const kpiAlerts = pgTable("kpi_alerts", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    kpiId: uuid("kpi_id").notNull().references(() => kpiDefinitions.id),
    branchId: uuid("branch_id"),
    
    // Alert Details
    alertType: text("alert_type").notNull(), // 'WARNING' | 'CRITICAL'
    status: kpiAlertStatusEnum("status").default('ACTIVE').notNull(),
    triggeredValue: integer("triggered_value").notNull(), // KPI value when alert triggered
    threshold: integer("threshold").notNull(), // Threshold that was crossed
    
    // Message
    title: text("title").notNull(),
    message: text("message").notNull(),
    
    // Resolution
    acknowledgedBy: text("acknowledged_by"), // User ID who acknowledged
    acknowledgedAt: timestamp("acknowledged_at"),
    resolutionNotes: text("resolution_notes"),
    resolvedBy: text("resolved_by"), // User ID who resolved
    resolvedAt: timestamp("resolved_at"),
    
    // Notification tracking
    notifiedUsers: jsonb("notified_users"), // Array of user IDs who were notified
    notificationSent: boolean("notification_sent").default(false),
    
    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Vacation Requests table
export const vacationStatusEnum = pgEnum("vacation_status", ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED']);

export const vacationRequests = pgTable("vacation_requests", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),

    // Vacation period
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    totalDays: integer("total_days").notNull(),

    // Status tracking
    status: vacationStatusEnum("status").default('PENDING').notNull(),

    // Approval workflow
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    approvedBy: text("approved_by"), // User ID of approver
    approvedAt: timestamp("approved_at"),
    rejectedBy: text("rejected_by"),
    rejectedAt: timestamp("rejected_at"),
    cancelledAt: timestamp("cancelled_at"),

    // Comments and notes
    reason: text("reason"), // Employee's reason for vacation
    managerComments: text("manager_comments"),
    rejectionReason: text("rejection_reason"),

    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// =====================================================
// EMPLOYEE RECORD MANAGEMENT SYSTEM
// =====================================================

// Employee Status Enum
export const employeeStatusEnum = pgEnum("employee_status", [
    'ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED'
]);

// Contract Type Enum (Mexican Labor Law)
export const contractTypeEnum = pgEnum("contract_type", [
    'DETERMINATE', 'INDETERMINATE', 'PROBATION', 'TRAINING', 'SEASONAL', 'PART_TIME'
]);

// Work Regime Enum
export const workRegimeEnum = pgEnum("work_regime", [
    'DAILY', 'MIXED', 'NIGHT', 'SPLIT_SHIFT', 'ON_CALL'
]);

// Payment Method Enum
export const paymentMethodEnum = pgEnum("payment_method", [
    'BANK_TRANSFER', 'CHECK', 'CASH', 'PAYROLL_CARD'
]);

// Gender Enum
export const genderEnum = pgEnum("gender", [
    'MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'
]);

// Marital Status Enum
export const maritalStatusEnum = pgEnum("marital_status", [
    'SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'COMMON_LAW'
]);

// Blood Type Enum
export const bloodTypeEnum = pgEnum("blood_type", [
    'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'
]);

// Audit Action Enum
export const auditActionEnum = pgEnum("audit_action", [
    'CREATE', 'UPDATE', 'DELETE', 'VIEW', 'EXPORT', 'IMPORT'
]);

// Onboarding Step Status
export const onboardingStepStatusEnum = pgEnum("onboarding_step_status", [
    'PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'BLOCKED'
]);

// Offboarding Reason
export const offboardingReasonEnum = pgEnum("offboarding_reason", [
    'VOLUNTARY_RESIGNATION', 'TERMINATION_WITH_CAUSE', 'TERMINATION_WITHOUT_CAUSE',
    'CONTRACT_EXPIRED', 'RETIREMENT', 'DEATH', 'MUTUAL_AGREEMENT', 'OTHER'
]);

// Performance Review Enums
export const reviewTypeEnum = pgEnum("review_type", ['SELF', 'MANAGER', 'PEER', '360']);
export const reviewStatusEnum = pgEnum("review_status", ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'SUBMITTED']);
export const goalStatusEnum = pgEnum("goal_status", ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

// Leave Management Enums
export const leaveTypeEnum = pgEnum("leave_type", [
    'VACATION', 'SICK_LEAVE', 'PERSONAL', 'MATERNITY', 'PATERNITY', 'BEREAVEMENT', 'TRAINING', 'JURY_DUTY', 'OTHER'
]);
export const leaveStatusEnum = pgEnum("leave_status", ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED']);

// Employee Profile Extension (extends users table)
export const employeeProfiles = pgTable("employee_profiles", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id), // Links to users table

    // Personal Information
    dateOfBirth: timestamp("date_of_birth"),
    curp: text("curp"), // Mexican unique population registry code
    rfc: text("rfc"), // Mexican tax ID
    nss: text("nss"), // Mexican social security number
    gender: genderEnum("gender"),
    maritalStatus: maritalStatusEnum("marital_status"),
    bloodType: bloodTypeEnum("blood_type"),
    nationality: text("nationality").default('MEXICANA'),

    // Contact Information
    personalEmail: text("personal_email"),
    personalPhone: text("personal_phone"),
    address: jsonb("address"), // { street, exteriorNumber, interiorNumber, neighborhood, city, state, zipCode }
    city: text("city"),
    state: text("state"),
    zipCode: text("zip_code"),

    // Emergency Contact
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    emergencyContactEmail: text("emergency_contact_email"),
    emergencyContactRelationship: text("emergency_contact_relationship"), // Spouse, Parent, Sibling, etc.

    // Bank Information (for payroll)
    bankName: text("bank_name"),
    clabe: text("clabe"), // Mexican bank account number (18 digits)
    cardNumber: text("card_number"), // Last 4 digits for display
    paymentMethod: paymentMethodEnum("payment_method").default('BANK_TRANSFER'),

    // Professional Information
    employeeNumber: text("employee_number"), // Internal employee ID
    department: text("department"), // Area/department
    position: text("position"), // Job title
    supervisorId: text("supervisor_id"), // References users.id
    hireDate: timestamp("hire_date"), // Date hired
    seniorityDate: timestamp("seniority_date"), // Date for seniority calculations (vacation accrual)
    probationEndDate: timestamp("probation_end_date"),

    // Employment Status
    employeeStatus: employeeStatusEnum("employee_status").default('ONBOARDING'),
    isActive: boolean("is_active").default(false),
    terminationDate: timestamp("termination_date"),
    terminationReason: offboardingReasonEnum("termination_reason"),
    rehireEligible: boolean("rehire_eligible").default(true), // Can be rehired?

    // Work Schedule Defaults
    defaultShiftId: uuid("default_shift_id"), // References planned_shifts.id
    standardHoursPerWeek: integer("standard_hours_per_week").default(48),

    // Additional Information
    languages: jsonb("languages"), // Array of languages spoken
    skills: jsonb("skills"), // Array of skills/certifications
    notes: text("notes"), // Internal notes (visible to HR/Managers only)

    // Profile Photo
    profilePhotoUrl: text("profile_photo_url"),

    // Audit
    createdBy: text("created_by").notNull(), // User ID who created
    updatedBy: text("updated_by"), // User ID who last updated
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});



// Employee Contracts
export const employeeContracts = pgTable("employee_contracts", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),

    // Contract Information
    contractNumber: text("contract_number").notNull(), // Internal contract ID
    contractType: contractTypeEnum("contract_type").notNull().default('INDETERMINATE'),
    workRegime: workRegimeEnum("work_regime").notNull().default('DAILY'),

    // Dates
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date"), // null for indeterminate contracts
    probationPeriodDays: integer("probation_period_days"), // 30, 60, 90, 180 days
    signatureDate: timestamp("signature_date"),

    // Compensation
    baseSalary: integer("base_salary").notNull(), // Daily salary in cents
    monthlySalary: integer("monthly_salary"), // Calculated monthly salary
    weeklySalary: integer("weekly_salary"), // Calculated weekly salary
    currency: text("currency").default('MXN'),

    // Benefits
    hasHealthInsurance: boolean("has_health_insurance").default(false),
    hasLifeInsurance: boolean("has_life_insurance").default(false),
    hasSavingsFund: boolean("has_savings_fund").default(false), // Fondo de ahorro
    hasFoodVouchers: boolean("has_food_vouchers").default(false), // Vales de despensa
    hasTransportationBonus: boolean("has_transportation_bonus").default(false),
    benefitsNotes: text("benefits_notes"),

    // Work Schedule
    workStartTime: text("work_start_time"), // Default start time (e.g., "08:00")
    workEndTime: text("work_end_time"), // Default end time (e.g., "17:00")
    workDays: integer("work_days").array(), // [1,2,3,4,5] = Mon-Fri
    breakDurationMinutes: integer("break_duration_minutes").default(60),

    // Contract Status
    status: text("status").default('ACTIVE'), // ACTIVE, EXPIRED, TERMINATED, RENEWED
    renewalDate: timestamp("renewal_date"), // When contract needs renewal
    autoRenew: boolean("auto_renew").default(false),

    // Document Reference
    contractDocumentId: uuid("contract_document_id"), // Links to employee_documents.id

    // Approval
    approvedBy: text("approved_by"), // HR/Manager who approved
    approvedAt: timestamp("approved_at"),

    // Notes
    terms: text("terms"), // Special terms and conditions
    notes: text("notes"),

    // Audit
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Salary History
export const salaryHistory = pgTable("salary_history", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    contractId: uuid("contract_id").references(() => employeeContracts.id),

    // Salary Details
    previousSalary: integer("previous_salary"), // Previous salary in cents
    newSalary: integer("new_salary").notNull(), // New salary in cents
    percentageChange: integer("percentage_change"), // Percentage increase/decrease

    // Change Reason
    changeType: text("change_type").notNull(), // ANNUAL_RAISE, PROMOTION, ADJUSTMENT, CORRECTION
    reason: text("reason"), // Detailed reason
    effectiveDate: timestamp("effective_date").notNull(),

    // Approval
    approvedBy: text("approved_by").notNull(), // User ID of approver
    approvedAt: timestamp("approved_at").defaultNow().notNull(),

    // Documentation
    documentId: uuid("document_id"), // Links to employee_documents.id if applicable
    notes: text("notes"),

    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Employee Audit Trail
export const employeeAuditLogs = pgTable("employee_audit_logs", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id), // Employee affected

    // Action Details
    action: auditActionEnum("action").notNull(), // CREATE, UPDATE, DELETE, VIEW, etc.
    entityType: text("entity_type").notNull(), // PROFILE, CONTRACT, SALARY, DOCUMENT, etc.
    entityId: text("entity_id"), // ID of the entity affected

    // Change Tracking
    fieldName: text("field_name"), // Which field was changed
    oldValue: jsonb("old_value"), // Previous value
    newValue: jsonb("new_value"), // New value

    // Context
    performedBy: text("performed_by").notNull(), // User ID who performed the action
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"), // IP address of the action
    userAgent: text("user_agent"), // Browser/device info
    reason: text("reason"), // Reason for the change

    // Compliance
    isSensitive: boolean("is_sensitive").default(false), // Sensitive data change (salary, personal info)
    requiresApproval: boolean("requires_approval").default(false), // Needs HR approval
    approvedBy: text("approved_by"), // If approval required
    approvedAt: timestamp("approved_at"),

    // Retention
    retentionUntil: timestamp("retention_until"), // Keep audit log until this date

    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Employee Onboarding Checklists
export const employeeOnboarding = pgTable("employee_onboarding", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),

    // Onboarding Status
    status: text("status").default('IN_PROGRESS'), // IN_PROGRESS, COMPLETED, CANCELLED
    startDate: timestamp("start_date").notNull(), // When onboarding started
    targetEndDate: timestamp("target_end_date"), // When onboarding should complete
    completedDate: timestamp("completed_date"), // When actually completed

    // Assigned Buddy/Mentor
    assignedBuddyId: text("assigned_buddy_id"), // User ID of onboarding buddy
    assignedMentorId: text("assigned_mentor_id"), // User ID of mentor

    // Progress Tracking
    totalSteps: integer("total_steps").default(0),
    completedSteps: integer("completed_steps").default(0),
    progressPercentage: integer("progress_percentage").default(0), // 0-100

    // Notes
    notes: text("notes"),
    hrNotes: text("hr_notes"), // Internal HR notes

    // Audit
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Onboarding Steps
export const onboardingSteps = pgTable("onboarding_steps", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    onboardingId: uuid("onboarding_id").notNull().references(() => employeeOnboarding.id),

    // Step Details
    stepName: text("step_name").notNull(), // e.g., "Upload ID", "Sign Contract", "Safety Training"
    stepCategory: text("step_category").notNull(), // DOCUMENTS, TRAINING, SETUP, COMPLIANCE, ORIENTATION
    description: text("description"),
    assignedTo: text("assigned_to"), // User ID responsible for this step

    // Status
    status: onboardingStepStatusEnum("status").default('PENDING'),
    dueDate: timestamp("due_date"),
    completedDate: timestamp("completed_date"),
    completedBy: text("completed_by"), // User ID who completed

    // Documentation
    requiredDocumentId: uuid("required_document_id"), // Links to employee_documents.id if applicable
    notes: text("notes"),

    // Dependencies
    dependsOnStepId: uuid("depends_on_step_id"), // Self-reference to another step

    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Offboarding
export const employeeOffboarding = pgTable("employee_offboarding", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),

    // Offboarding Details
    reason: offboardingReasonEnum("reason").notNull(),
    reasonDetails: text("reason_details"), // Additional context

    // Dates
    resignationDate: timestamp("resignation_date"), // When employee notified
    lastWorkingDay: timestamp("last_working_day").notNull(),
    finalPayDate: timestamp("final_pay_date"), // When final payment processed

    // Financial Settlement
    accruedVacationDays: integer("accrued_vacation_days").default(0), // Days owed
    vacationPay: integer("vacation_pay").default(0), // Payment for accrued vacation in cents
    seniorityBonus: integer("seniority_bonus").default(0), // Prima de antigüedad if applicable
    severancePay: integer("severance_pay").default(0), // Severance if terminated
    finalPayAmount: integer("final_pay_amount").default(0), // Total final payment
    deductions: integer("deductions").default(0), // Any deductions
    currency: text("currency").default('MXN'),

    // Asset Return
    assetsToReturn: jsonb("assets_to_return"), // List of assets (laptop, uniform, keys, etc.)
    assetsReturned: boolean("assets_returned").default(false),
    assetsReturnDate: timestamp("assets_return_date"),
    assetsNotes: text("assets_notes"),

    // Exit Interview
    exitInterviewCompleted: boolean("exit_interview_completed").default(false),
    exitInterviewDate: timestamp("exit_interview_date"),
    exitInterviewNotes: text("exit_interview_notes"),
    conductedBy: text("conducted_by"), // User ID who conducted interview

    // Compliance
    benefitsSettled: boolean("benefits_settled").default(false),
    socialSecurityCancelled: boolean("social_security_cancelled").default(false),
    documentsArchived: boolean("documents_archived").default(false),
    accessRevoked: boolean("access_revoked").default(false),
    accessRevokedDate: timestamp("access_revoked_date"),

    // Status
    status: text("status").default('IN_PROGRESS'), // IN_PROGRESS, PENDING_FINAL_PAY, COMPLETED, CANCELLED
    completedDate: timestamp("completed_date"),

    // Approval
    approvedBy: text("approved_by"), // HR/Manager approval
    approvedAt: timestamp("approved_at"),

    // Notes
    hrNotes: text("hr_notes"), // Internal HR notes
    notes: text("notes"),

    // Audit
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Benefits Tracking
export const employeeBenefits = pgTable("employee_benefits", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),

    // Benefit Details
    benefitType: text("benefit_type").notNull(), // HEALTH_INSURANCE, LIFE_INSURANCE, SAVINGS_FUND, FOOD_VOUCHERS, etc.
    provider: text("provider"), // Insurance company, bank, etc.
    policyNumber: text("policy_number"),
    coverageAmount: integer("coverage_amount"), // In cents

    // Status
    isActive: boolean("is_active").default(true),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date"), // When benefit expires

    // Employee Contribution
    employeeContribution: integer("employee_contribution").default(0), // Monthly in cents
    employerContribution: integer("employer_contribution").default(0), // Monthly in cents

    // Beneficiaries
    beneficiaries: jsonb("beneficiaries"), // Array of beneficiary objects

    // Documentation
    documentId: uuid("document_id"), // Links to employee_documents.id

    // Notes
    notes: text("notes"),

    // Audit
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Training & Certifications
export const employeeTraining = pgTable("employee_training", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),

    // Training Details
    trainingName: text("training_name").notNull(),
    trainingType: text("training_type").notNull(), // MANDATORY, SAFETY, SKILL_DEVELOPMENT, COMPLIANCE, CERTIFICATION
    provider: text("provider"), // Who provided the training
    instructor: text("instructor"),

    // Dates
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date"),
    completionDate: timestamp("completion_date"),
    expirationDate: timestamp("expiration_date"), // For certifications that expire

    // Status
    status: text("status").default('IN_PROGRESS'), // IN_PROGRESS, COMPLETED, EXPIRED, CANCELLED
    grade: text("grade"), // Grade/score if applicable
    passed: boolean("passed"), // Whether employee passed

    // Certification
    certificationNumber: text("certification_number"),
    issuingAuthority: text("issuing_authority"),
    isMandatory: boolean("is_mandatory").default(false), // Required for compliance

    // Documentation
    certificateDocumentId: uuid("certificate_document_id"), // Links to employee_documents.id

    // Cost
    cost: integer("cost").default(0), // Training cost in cents
    companyPaid: boolean("company_paid").default(true),

    // Notes
    notes: text("notes"),

    // Audit
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Vacation Accrual Tracking
export const vacationAccruals = pgTable("vacation_accruals", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),

    // Accrual Period
    year: integer("year").notNull(), // Year of accrual
    month: integer("month"), // Month of accrual (1-12), null for annual

    // Days Calculation
    daysAccrued: integer("days_accrued").notNull(), // Days earned in this period
    daysTaken: integer("days_taken").default(0), // Days already used
    daysBalance: integer("days_balance").notNull(), // Remaining days

    // Seniority-based calculation
    yearsOfService: integer("years_of_service").notNull(), // Years at company
    applicableLawDays: integer("applicable_law_days").notNull(), // Days per LFT based on seniority

    // Period
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),

    // Status
    isProcessed: boolean("is_processed").default(false), // Has been processed by payroll
    processedAt: timestamp("processed_at"),

    // Notes
    notes: text("notes"),

    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// =====================================================
// EMPLOYEE RECORD MANAGEMENT SYSTEM - END
// =====================================================

// =====================================================
// PHASE 2: ADVANCED HR FEATURES
// =====================================================

// Performance Review Enums
export const performanceReviewTypeEnum = pgEnum("performance_review_type", ['SELF', 'MANAGER', 'PEER', '360']);
export const performanceReviewStatusEnum = pgEnum("performance_review_status", ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'SUBMITTED']);
export const performanceGoalStatusEnum = pgEnum("performance_goal_status", ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const performanceCategoryEnum = pgEnum("performance_category", ['TECHNICAL', 'SOFT_SKILLS', 'LEADERSHIP', 'COMMUNICATION', 'PROBLEM_SOLVING', 'TEAMWORK']);

// Leave Management Enums
export const leaveRequestStatusEnum = pgEnum("leave_request_status", ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED']);

// Performance Reviews Table
export const performanceReviews = pgTable("performance_reviews", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id), // Employee being reviewed
    reviewerId: text("reviewer_id").notNull().references(() => users.id), // Who is doing the review
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    
    // Review Configuration
    reviewType: performanceReviewTypeEnum("review_type").notNull(),
    reviewPeriod: text("review_period").notNull(), // e.g., "2026-Q1", "2026-H1", "2026-ANNUAL"
    reviewDate: timestamp("review_date").notNull().defaultNow(),
    
    // Status
    status: performanceReviewStatusEnum("status").notNull().default('DRAFT'),
    
    // Assessment
    overallRating: integer("overall_rating"), // 1-5
    strengths: text("strengths"),
    areasForImprovement: text("areas_for_improvement"),
    goals: jsonb("goals"), // [{ goal, target, deadline }]
    achievements: jsonb("achievements"),
    developmentPlan: text("development_plan"),
    comments: text("comments"),
    
    // Timestamps
    submittedAt: timestamp("submitted_at"),
    completedAt: timestamp("completed_at"),
    
    // Audit
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Performance Review Criteria Table
export const performanceReviewCriteria = pgTable("performance_review_criteria", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    
    // Criteria Details
    name: text("name").notNull(),
    description: text("description"),
    category: performanceCategoryEnum("category").notNull(),
    weight: integer("weight").default(1), // 1-10
    
    // Status
    isActive: boolean("is_active").default(true),
    
    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Performance Review Responses Table
export const performanceReviewResponses = pgTable("performance_review_responses", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    reviewId: uuid("review_id").notNull().references(() => performanceReviews.id),
    criteriaId: uuid("criteria_id").notNull().references(() => performanceReviewCriteria.id),
    
    // Response
    rating: integer("rating").notNull(), // 1-5
    comments: text("comments"),
    
    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Performance Goals Table
export const performanceGoals = pgTable("performance_goals", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    
    // Goal Details
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    
    // Status & Tracking
    status: performanceGoalStatusEnum("status").notNull().default('NOT_STARTED'),
    targetDate: timestamp("target_date"),
    completedDate: timestamp("completed_date"),
    
    // Metrics
    metrics: jsonb("metrics"), // Custom metrics for tracking progress
    
    // Audit
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Leave Types Table
export const leaveTypes = pgTable("leave_types", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    
    // Leave Configuration
    name: text("name").notNull(), // VACATION, SICK_LEAVE, PERSONAL, MATERNITY, PATERNITY, etc.
    description: text("description"),
    isPaid: boolean("is_paid").default(true),
    requiresDocumentation: boolean("requires_documentation").default(false),
    maxDaysPerYear: integer("max_days_per_year"),
    accrualRate: integer("accrual_rate"), // Days per year
    
    // Status
    isActive: boolean("is_active").default(true),
    
    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Leave Requests Table
export const leaveRequests = pgTable("leave_requests", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
    
    // Leave Period
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    totalDays: integer("total_days").notNull(),
    
    // Request Details
    reason: text("reason").notNull(),
    status: leaveRequestStatusEnum("status").notNull().default('PENDING'),
    
    // Supporting Documentation
    supportingDocumentId: uuid("supporting_document_id"), // Links to employeeDocuments.id
    
    // Approval Workflow
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at"),
    rejectedBy: text("rejected_by"),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    
    // Audit
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Leave Balances Table
export const leaveBalances = pgTable("leave_balances", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
    year: integer("year").notNull(),
    
    // Balance Tracking
    totalEntitlement: integer("total_entitlement").notNull(), // Total days per year
    used: integer("used").default(0), // Days used
    pending: integer("pending").default(0), // Days pending approval
    balance: integer("balance").notNull(), // Remaining days
    
    // Audit
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Employee Communications Table
export const employeeCommunications = pgTable("employee_communications", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    
    // Communication Details
    communicationType: text("communication_type").notNull(), // MESSAGE, ANNOUNCEMENT, NOTIFICATION
    title: text("title").notNull(),
    content: text("content").notNull(),
    
    // Targeting
    targetType: text("target_type").notNull(), // INDIVIDUAL, DEPARTMENT, BRANCH, COMPANY
    targetIds: jsonb("target_ids"), // Array of user IDs, department IDs, or branch IDs
    targetRoles: jsonb("target_roles"), // Array of roles (e.g., ['GERENTE', 'EMPLEADO'])
    
    // Status
    status: text("status").default('DRAFT'), // DRAFT, SENT, READ
    isPinned: boolean("is_pinned").default(false),
    
    // Delivery
    sentAt: timestamp("sent_at"),
    deliveredVia: jsonb("delivered_via"), // ['EMAIL', 'WHATSAPP', 'IN_APP']
    
    // Read Receipts
    readCount: integer("read_count").default(0),
    totalRecipients: integer("total_recipients").default(0),
    
    // Audit
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Communication Read Receipts Table
export const communicationReadReceipts = pgTable("communication_read_receipts", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    communicationId: uuid("communication_id").notNull().references(() => employeeCommunications.id),
    userId: text("user_id").notNull().references(() => users.id),
    readAt: timestamp("read_at").notNull().defaultNow(),
});

// Message Templates Table
export const messageTemplates = pgTable("message_templates", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id),

    // Template Details
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    content: text("content").notNull(),
    communicationType: text("communication_type").notNull(), // MESSAGE, ANNOUNCEMENT

    // Variables
    variables: jsonb("variables"), // Array of variable names that can be replaced

    // Status
    isActive: boolean("is_active").default(true),

    // Audit
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// =====================================================
// PHASE 3: PERFORMANCE & ANALYTICS
// =====================================================

// Saved Searches for Employees
export const savedSearches = pgTable("saved_searches", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),

    // Search Configuration
    name: text("name").notNull(),
    description: text("description"),
    searchCriteria: jsonb("search_criteria").notNull(), // { filters, sort, fields, etc. }
    entityType: text("entity_type").notNull().default('EMPLOYEE'), // EMPLOYEE, CONTRACT, etc.

    // Sharing
    isShared: boolean("is_shared").default(false),
    sharedWith: text("shared_with").array(), // Array of user IDs or roles

    // Usage
    usageCount: integer("usage_count").default(0),
    lastUsedAt: timestamp("last_used_at"),

    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Report Templates for custom report builder
export const reportTemplates = pgTable("report_templates", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),

    // Report Configuration
    name: text("name").notNull(),
    description: text("description"),
    reportType: text("report_type").notNull(), // STANDARD, CUSTOM, SCHEDULED
    dataSource: text("data_source").notNull(), // employees, contracts, attendance, performance, etc.

    // Configuration
    fields: jsonb("fields").notNull(), // Array of fields to include
    filters: jsonb("filters"), // Filter configuration
    groupBy: jsonb("group_by"), // Grouping configuration
    sortBy: jsonb("sort_by"), // Sorting configuration

    // Scheduling (for scheduled reports)
    schedule: jsonb("schedule"), // { frequency, dayOfWeek, dayOfMonth, time, timezone }
    nextRunAt: timestamp("next_run_at"),
    lastRunAt: timestamp("last_run_at"),
    lastRunStatus: text("last_run_status"), // SUCCESS, FAILED, RUNNING

    // Delivery
    deliveryMethod: text("delivery_method"), // EMAIL, DOWNLOAD, BOTH
    deliveryEmails: text("delivery_emails").array(), // Email addresses for delivery

    // Sharing
    createdBy: text("created_by").notNull(),
    isPublic: boolean("is_public").default(false), // Visible to all users in company
    sharedWith: text("shared_with").array(), // Array of user IDs or roles

    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Report Execution History
export const reportExecutionHistory = pgTable("report_execution_history", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    templateId: uuid("template_id").references(() => reportTemplates.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),

    // Execution Details
    reportType: text("report_type").notNull(), // STANDARD, CUSTOM
    dataSource: text("data_source").notNull(),
    executedBy: text("executed_by").notNull(), // User ID
    executedAt: timestamp("executed_at").defaultNow().notNull(),

    // Configuration
    filters: jsonb("filters"),
    fields: jsonb("fields"),

    // Results
    status: text("status").notNull(), // RUNNING, SUCCESS, FAILED
    rowCount: integer("row_count"),
    fileSize: integer("file_size"), // In bytes
    fileUrl: text("file_url"), // URL to generated report file
    fileKey: text("file_key"), // Storage key for cleanup

    // Performance
    durationMs: integer("duration_ms"), // Execution time in milliseconds
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Psychosocial Surveys (NOM-035 Real Data)
export const psychosocialRiskLevelEnum = pgEnum("psychosocial_risk_level", ['MINIMO', 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO']);

export const psychosocialSurveys = pgTable("psychosocial_surveys", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull(),
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    
    // NOM-035 Psychosocial Risk Factors (scores 0-100, higher = more risk)
    entornoOrganizacional: integer("entorno_organizacional").notNull().default(0),
    cargasTrabajo: integer("cargas_trabajo").notNull().default(0),
    liderazgo: integer("liderazgo").notNull().default(0),
    comunicacion: integer("comunicacion").notNull().default(0),
    desarrolloProfesional: integer("desarrollo_profesional").notNull().default(0),
    climaLaboral: integer("clima_laboral").notNull().default(0),
    
    // Calculated fields
    overallScore: integer("overall_score").notNull().default(0),
    riskLevel: psychosocialRiskLevelEnum("risk_level").notNull().default('MINIMO'),
    
    // Raw survey responses
    responses: jsonb("responses").default(sql`'[]'::jsonb`), // Array of { question, score, category }
    
    // Metadata
    surveyVersion: text("survey_version").default('v1'),
    completedAt: timestamp("completed_at"),
    isComplete: boolean("is_complete").default(false),
    
    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Compliance Alerts (auto-generated)
export const complianceAlertTypeEnum = pgEnum("compliance_alert_type", [
    'LOW_SCORE', 'MISSED_DEADLINE', 'MISSING_WORKFLOW', 'EXPIRED_DOCUMENT', 'NON_COMPLIANCE'
]);
export const complianceAlertStatusEnum = pgEnum("compliance_alert_status", [
    'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'
]);

export const complianceAlerts = pgTable("compliance_alerts", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id"),
    
    // Alert details
    alertType: complianceAlertTypeEnum("alert_type").notNull(),
    severity: incidentSeverityEnum("severity").notNull(),
    status: complianceAlertStatusEnum("status").default('ACTIVE').notNull(),
    
    title: text("title").notNull(),
    description: text("description"),
    
    // Context
    complianceType: text("compliance_type"), // NOM-251, NOM-035, LABOR_LAW
    workflowTemplateId: uuid("workflow_template_id"),
    currentScore: integer("current_score"),
    threshold: integer("threshold"),
    
    // Resolution
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    resolutionNotes: text("resolution_notes"),
    
    // Audit
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const employeeTrainingRecords = pgTable("employee_training_records", {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    userId: text("user_id").notNull(),
    companyId: uuid("company_id").notNull(),
    courseName: text("course_name").notNull(), // "Prácticas Higiénicas NOM-251"
    completedAt: timestamp("completed_at").defaultNow().notNull(),
    score: integer("score").notNull(),
    certificateUrl: text("certificate_url"),
    status: text("status").default('ACTIVE'), // ACTIVE, EXPIRED
    expiresAt: timestamp("expires_at").notNull(),
});

// Adding manual reference definitions where appropriate for clarity or Drizzle query API
export const accountRelations = {
    user: foreignKey({
        columns: [account.userId],
        foreignColumns: [users.id],
    })
}

export const sessionsRelations = {
    user: foreignKey({
        columns: [sessions.userId],
        foreignColumns: [users.id],
    })
}
