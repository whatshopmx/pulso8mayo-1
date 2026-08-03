import { pgTable, text, timestamp, boolean, uuid, jsonb, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, branches } from "./core";
import { users } from "./auth";

// ============================================
// PROTECCION CIVIL — Fase 7 (T20)
// Bitacora de simulacros, inspeccion de extintores (OCR) y
// checklist fotografico de salidas de emergencia.
// NOM-002-STPS-2010 + Codigo Nacional de Proteccion Civil.
// ============================================

// Tipo de simulacro
export const drillTypeEnum = pgEnum("civil_drill_type", [
  'EVACUACION',
  'CONFINAMIENTO',
  'SIMULACRO_GENERAL',
  'SISMO',
  'INCENDIO',
  'OTRO',
]);

// Resultado del simulacro
export const drillResultEnum = pgEnum("civil_drill_result", [
  'EXITOSO',
  'ACEPTABLE',
  'REQUIERE_MEJORA',
  'FALLIDO',
]);

// Estado del extintor
export const extinguisherStatusEnum = pgEnum("civil_extinguisher_status", [
  'OPTIMO',
  'ACEPTABLE',
  'REQUIERE_RECARGA',
  'DESCARTADO',
  'PERDIDO',
]);

// ============================================
// SIMULACROS
// ============================================

export const civilProtectionDrills = pgTable("civil_protection_drills", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),

  // Tipo y resultado
  drillType: drillTypeEnum("drill_type").notNull(),
  result: drillResultEnum("result"),

  // Detalles del simulacro
  drillDate: timestamp("drill_date").notNull(),
  participantsCount: integer("participants_count"),
  evacuationTimeSec: integer("evacuation_time_sec"),
  activatedAlarm: boolean("activated_alarm").default(true),
  observations: text("observations"),

  // Evidencia
  evidenceUrls: jsonb("evidence_urls").default(sql`'[]'::jsonb`), // Array de URLs (fotos/videos)
  reportUrl: text("report_url"), // Acta del simulacro firmada

  // Responsable
  coordinatorName: text("coordinator_name"),
  coordinatorPhone: text("coordinator_phone"),

  // Workflow link (si el simulacro fue ejecutado via workflow)
  workflowInstanceId: uuid("workflow_instance_id"),

  // Auditoria
  createdBy: text("created_by").notNull().references(() => users.id),
  updatedBy: text("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  cpDrillsCompanyIdx: index("cp_drills_company_idx").on(table.companyId),
  cpDrillsBranchIdx: index("cp_drills_branch_idx").on(table.branchId, table.drillDate),
}));

// ============================================
// INSPECCION DE EXTINTORES (con OCR de fechas)
// ============================================

export const extinguisherInspections = pgTable("extinguisher_inspections", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),

  // Identificacion del extintor
  extinguisherId: text("extinguisher_id").notNull(), // Codigo interno, ej. "EXT-COC-001"
  location: text("location").notNull(), // ej. "Cocina principal"
  extinguisherType: text("extinguisher_type"), // CO2, ABC, PQS, etc.
  capacityKg: integer("capacity_kg"),

  // Inspeccion
  inspectionDate: timestamp("inspection_date").notNull(),
  pressureOk: boolean("pressure_ok"),
  sealOk: boolean("seal_ok"),
  hoseOk: boolean("hose_ok"),
  labelOk: boolean("label_ok"),
  generalStatus: extinguisherStatusEnum("general_status"),

  // Fechas criticas (extraidas via OCR cuando sea posible)
  expirationDate: timestamp("expiration_date"),
  lastRechargeDate: timestamp("last_recharge_date"),
  nextInspectionDate: timestamp("next_inspection_date"),

  // OCR
  ocrRawData: jsonb("ocr_raw_data"), // { rawText, extractedDates, confidence, fullText }
  ocrProcessedAt: timestamp("ocr_processed_at"),

  // Evidencia
  evidenceUrl: text("evidence_url"), // Foto de la placa del extintor

  // Inspector
  inspectorName: text("inspector_name"),
  inspectorNotes: text("inspector_notes"),

  // Workflow link
  workflowInstanceId: uuid("workflow_instance_id"),

  // Auditoria
  createdBy: text("created_by").notNull().references(() => users.id),
  updatedBy: text("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  cpExtBranchIdx: index("cp_ext_branch_idx").on(table.branchId, table.inspectionDate),
  cpExtCompanyIdx: index("cp_ext_company_idx").on(table.companyId, table.extinguisherId),
}));

// ============================================
// CHECKLIST DE SALIDAS DE EMERGENCIA
// ============================================

export const exitChecklistItems = pgTable("exit_checklist_items", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),

  // Ubicacion de la salida
  exitLocation: text("exit_location").notNull(), // ej. "Puerta principal", "Salida trasera"

  // Estado del checklist
  isClear: boolean("is_clear").notNull(), // Salida despejada (sin obstaculos)
  signageOk: boolean("signage_ok").notNull(), // Senalizacion visible
  emergencyLightOk: boolean("emergency_light_ok").notNull(), // Luz de emergencia funcional
  doorOpensOk: boolean("door_opens_ok").notNull(), // Puerta abre facilmente
  accessWidthCm: integer("access_width_cm"), // Ancho util de paso (cm)

  // Evidencia fotografica
  photoUrl: text("photo_url"),
  photos: jsonb("photos").default(sql`'[]'::jsonb`), // Array de URLs para multiples fotos

  // Observaciones
  notes: text("notes"),
  issuesDetected: text("issues_detected"),

  // Inspeccion
  inspectedAt: timestamp("inspected_at").notNull(),
  inspectedBy: text("inspected_by").notNull().references(() => users.id),
  inspectionRound: text("inspection_round"), // ej. "Apertura", "Cierre", "Semanal"

  // Workflow link
  workflowInstanceId: uuid("workflow_instance_id"),

  // Auditoria
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  cpExitsBranchIdx: index("cp_exits_branch_idx").on(table.branchId, table.inspectedAt),
}));