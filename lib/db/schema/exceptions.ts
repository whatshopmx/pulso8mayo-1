/**
 * Canonical Exception — Phase 0 / Epic 0.1 (Control Core).
 *
 * `exceptions` es la capa transversal de control: una fila por anomalía u
 * obligación fuera de rango, con lifecycle, owner y SLA. NO sustituye a las
 * fuentes de dominio (`incidents`, `compliance_alerts`, `equipment_alerts`,
 * `nom035_action_plans`, `shift_approvals`, `shift_change_requests`,
 * `inventory_alerts`, `daily_sales_cuts`, `invoices`): cada dominio conserva su
 * writer y su pantalla; los adaptadores proyectan esas filas aquí mediante
 * upsert idempotente por `(company_id, subject_type, subject_id)`.
 *
 * El vocabulario es el que ya consume la UI de excepciones
 * (`lib/services/group-exceptions-service.ts`): no se inventan enums nuevos.
 */
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, branches } from "./core";
import { users } from "./auth";

// ── Enums (vocabulario existente) ──

export const exceptionDomainEnum = pgEnum("exception_domain", [
  "operacion",
  "cumplimiento",
  "equipos",
  "personal",
  "inventario",
  "finanzas",
]);

export const exceptionSeverityEnum = pgEnum("exception_severity", [
  "info",
  "warning",
  "high",
  "critical",
  "fatal",
]);

export const qsrRiskCategoryEnum = pgEnum("qsr_risk_category", [
  "DINERO",
  "INOCUIDAD",
  "ABASTO",
  "PERSONAL",
]);

/**
 * Lifecycle canónico. Las transiciones legales viven en
 * `lib/services/exception-lifecycle.ts` (módulo puro); aquí solo se declara el
 * conjunto de estados.
 *
 * OPEN → ASSIGNED → IN_ACTION → RESOLVED → VERIFIED → CLOSED
 * con REOPENED / ESCALATED / CANCELLED como salidas laterales.
 */
export const exceptionStatusEnum = pgEnum("exception_status", [
  "OPEN",
  "ASSIGNED",
  "IN_ACTION",
  "RESOLVED",
  "VERIFIED",
  "CLOSED",
  "REOPENED",
  "ESCALATED",
  "CANCELLED",
]);

export const exceptions = pgTable(
  "exceptions",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),

    domain: exceptionDomainEnum("domain").notNull(),
    qsrCategory: qsrRiskCategoryEnum("qsr_category").notNull(),
    severity: exceptionSeverityEnum("severity").notNull().default("warning"),

    /** Tipo estable del sujeto (p. ej. `incident`, `invoice_discrepancy`). */
    subjectType: text("subject_type").notNull(),
    /** Id del sujeto en su tabla de dominio (uuid o texto). */
    subjectId: text("subject_id").notNull(),

    reason: text("reason").notNull(),
    status: exceptionStatusEnum("status").notNull().default("OPEN"),

    ownerId: text("owner_id"),
    slaDueAt: timestamp("sla_due_at"),

    /** Metadata de la acción sugerida (label/url/whatsappSuggestedMessage). */
    actionMeta: jsonb("action_meta"),

    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at"),

    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at"),

    closedAt: timestamp("closed_at"),

    /**
     * FK a `evidence.id`. Se deja sin constraint aquí para no crear una
     * dependencia circular entre migraciones; Task 13 la agrega al crear la
     * tabla `evidence`.
     */
    evidenceId: uuid("evidence_id"),

    /** Excepción de la que se reabrió esta (traza de reapertura). */
    reopenedFromId: uuid("reopened_from_id"),

    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    exceptionsSubjectUnique: uniqueIndex(
      "exceptions_company_subject_unique",
    ).on(table.companyId, table.subjectType, table.subjectId),
    exceptionsBoardIdx: index("exceptions_company_status_severity_sla_idx").on(
      table.companyId,
      table.status,
      table.severity,
      table.slaDueAt,
    ),
    exceptionsBranchStatusIdx: index(
      "exceptions_company_branch_status_idx",
    ).on(table.companyId, table.branchId, table.status),
    exceptionsOwnerIdx: index("exceptions_owner_status_idx").on(
      table.ownerId,
      table.status,
    ),
    exceptionsOwnerIdFk: foreignKey({
      columns: [table.ownerId],
      foreignColumns: [users.id],
      name: "exceptions_owner_id_fkey",
    }),
    exceptionsResolvedByIdFk: foreignKey({
      columns: [table.resolvedBy],
      foreignColumns: [users.id],
      name: "exceptions_resolved_by_fk",
    }),
    exceptionsVerifiedByIdFk: foreignKey({
      columns: [table.verifiedBy],
      foreignColumns: [users.id],
      name: "exceptions_verified_by_fk",
    }),
  }),
);
