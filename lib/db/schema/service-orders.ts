import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  uuid,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, branches } from "./core";
import { branchComplianceServices } from "./equipment";

// ── Enums ──

export const serviceOrderTypeEnum = pgEnum("service_order_type", [
  'CORRECTIVO',
  'PREVENTIVO',
  'CONTRACTUAL',
  'EXTRAORDINARIO'
]);

export const serviceUrgencyEnum = pgEnum("service_urgency", [
  'NORMAL',
  'URGENTE',
  'EMERGENCIA'
]);

export const serviceOrderStatusEnum = pgEnum("service_order_status", [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
  'PENDING_CONFORMITY',
  'CLOSED',
  'REJECTED',
  'CANCELLED'
]);

export const purchaseTypeEnum = pgEnum("purchase_type", [
  'PROGRAMADA',
  'STOCK',
  'EMERGENCIA'
]);

export const approvalDocTypeEnum = pgEnum("approval_doc_type", ['OC', 'OS']);

export const approvalRequestStatusEnum = pgEnum("approval_request_status", [
  'PENDING',
  'APPROVED',
  'REJECTED'
]);

export const evidenceTypeEnum = pgEnum("evidence_type", ['ANTES', 'DESPUES']);

// ── Órdenes de Servicio ──

export const serviceOrders = pgTable("service_orders", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  folio: text("folio").notNull().unique(),

  type: serviceOrderTypeEnum("type").notNull(),
  urgency: serviceUrgencyEnum("urgency").default('NORMAL').notNull(),
  status: serviceOrderStatusEnum("status").default('DRAFT').notNull(),

  // Equipo opcional (OS independiente; FK opcional a branch_equipments)
  equipmentId: uuid("equipment_id"),

  // Servicio normativo origen (opcional; FK a branch_compliance_services)
  complianceServiceId: uuid("compliance_service_id").references(() => branchComplianceServices.id),

  scope: text("scope"),           // Alcance del servicio
  justification: text("justification"),
  technicalReport: text("technical_report"),

  supplierId: uuid("supplier_id"),
  amount: integer("amount"),      // Centavos

  scheduledDate: timestamp("scheduled_date"),
  completedAt: timestamp("completed_at"),

  costCenterId: uuid("cost_center_id"),

  // Conformidad
  conformitySignedBy: text("conformity_signed_by"),
  conformitySignedAt: timestamp("conformity_signed_at"),

  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  serviceOrdersCompanyBranchIdx: index("service_orders_company_branch_idx").on(table.companyId, table.branchId),
  serviceOrdersStatusIdx: index("service_orders_status_idx").on(table.status),
}));

export const serviceOrderQuotes = pgTable("service_order_quotes", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  serviceOrderId: uuid("service_order_id").notNull().references(() => serviceOrders.id),
  url: text("url").notNull(),          // R2 / local fallback
  supplierName: text("supplier_name"),
  amount: integer("amount"),           // Centavos
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const serviceOrderEvidence = pgTable("service_order_evidence", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  serviceOrderId: uuid("service_order_id").notNull().references(() => serviceOrders.id),
  type: evidenceTypeEnum("type").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Contador de folios ──
// Consecutivo por empresa+ sucursal+ tipo+ año. El generador (folio-generator.ts)
// hace INSERT..ON CONFLICT DO UPDATE RETURNING: una sola sentencia atómica que
// toma el lock de fila — dos llamadas concurrentes nunca obtienen el mismo número.
export const folioCounters = pgTable("folio_counters", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  docType: approvalDocTypeEnum("doc_type").notNull(), // OC | OS
  year: integer("year").notNull(),
  lastSequence: integer("last_sequence").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  folioCountersUnique: uniqueIndex("folio_counters_unique").on(
    table.companyId, table.branchId, table.docType, table.year
  ),
}));

// ── Matriz de autorización ──

export const approvalMatrixRules = pgTable("approval_matrix_rules", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),

  docType: approvalDocTypeEnum("doc_type").notNull(),
  amountMin: integer("amount_min").notNull(),   // Centavos, inclusivo
  amountMax: integer("amount_max"),             // Centavos, exclusivo; NULL = sin límite
  requiredRole: text("required_role").notNull(),// OWNER|ADMIN|GERENTE|SUPERVISOR
  minQuotes: integer("min_quotes").default(1).notNull(),
  sequence: integer("sequence").default(1).notNull(), // Nivel en la cadena
  active: boolean("active").default(true).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  approvalMatrixRulesCompanyIdx: index("approval_matrix_rules_company_idx").on(table.companyId, table.docType),
}));

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),

  docType: approvalDocTypeEnum("doc_type").notNull(),
  docId: uuid("doc_id").notNull(),       // serviceOrders.id | purchaseOrders.id
  companyId: uuid("company_id").notNull().references(() => companies.id),

  level: integer("level").notNull(),
  requiredRole: text("required_role").notNull(),
  minQuotes: integer("min_quotes").default(1).notNull(),

  status: approvalRequestStatusEnum("status").default('PENDING').notNull(),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  reason: text("reason"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  approvalRequestsDocIdx: index("approval_requests_doc_idx").on(table.docType, table.docId),
  approvalRequestsPendingIdx: index("approval_requests_pending_idx").on(table.companyId, table.status),
}));

// ── Centros de costo y presupuestos ──

export const costCenters = pgTable("cost_centers", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  accountingLine: text("accounting_line"), // Partida contable
  active: boolean("active").default(true).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  costCentersCompanyCodeUnique: uniqueIndex("cost_centers_company_code_unique").on(table.companyId, table.code),
}));

export const branchBudgets = pgTable("branch_budgets", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  branchId: uuid("branch_id").notNull().references(() => branches.id),
  costCenterId: uuid("cost_center_id").notNull().references(() => costCenters.id),
  month: text("month").notNull(),        // YYYY-MM
  amount: integer("amount").notNull(),   // Centavos

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  branchBudgetsUnique: uniqueIndex("branch_budgets_branch_cc_month_unique").on(
    table.branchId, table.costCenterId, table.month
  ),
}));
