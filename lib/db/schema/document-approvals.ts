/**
 * APR-01 — Registro canónico de aprobaciones de documentos financieros
 * (`OC`, `OS`, `INVOICE`, `EXPENSE`, `PAYMENT_RUN`, `PAYROLL`).
 *
 * No sustituye a las especializaciones existentes (`approval_requests` para
 * OC/OS, `invoices` para excepciones 3-Way Match de factura, `operating_expenses`
 * para gastos, `payment_approvals`/`payment_runs` para corridas de pago,
 * `payroll_runs.ordinary_snapshot` para nómina NOM-03).
 * En cambio, proporciona un contrato transversal común que declara:
 *  - versión aprobada monotónica (`approval_version`)
 *  - alcance de sucursal (`branch_id`), motivo (`approval_reason`) y evidencia (`evidence_id`)
 *  - huella material SHA-256 + instantánea (`material_fingerprint`, `material_snapshot`)
 *  - autoridad declarada (`required_role`, `authority_source`, `approved_by`,
 *    `approved_by_role`, `secondary_approved_by`)
 *  - invalidación auditada cuando ocurre un cambio material (`status = 'INVALIDATED'`,
 *    `changed_fields`, `invalidated_by`, `invalidation_reason`).
 */
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { branches, companies } from "./core";
import { users } from "./auth";

export const documentApprovals = pgTable(
  "document_approvals",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    /** Sucursal del documento (null para documentos corporativos como nómina o corridas multi-sucursal). */
    branchId: uuid("branch_id").references(() => branches.id),

    /** OC | OS | INVOICE | EXPENSE | PAYMENT_RUN | PAYROLL */
    docType: text("doc_type").notNull(),
    docId: uuid("doc_id").notNull(),

    /** Versión aprobada monotónica (1, 2, 3...) por (company_id, doc_type, doc_id). */
    approvalVersion: integer("approval_version").notNull(),
    /** APPROVED | INVALIDATED */
    status: text("status").notNull().default("APPROVED"),

    /** SHA-256 canónico de los campos materiales aprobados. */
    materialFingerprint: text("material_fingerprint").notNull(),
    /** Instantánea inmutable de los campos materiales aprobados (para diff). */
    materialSnapshot: jsonb("material_snapshot").notNull(),

    /** Autoridad declarada y fuente de política especializada. */
    requiredRole: text("required_role").notNull(),
    authoritySource: text("authority_source").notNull(),
    approvedBy: text("approved_by")
      .notNull()
      .references(() => users.id),
    approvedByRole: text("approved_by_role").notNull(),
    secondaryApprovedBy: text("secondary_approved_by").references(() => users.id),
    approvalReason: text("approval_reason"),
    /** Identificador de evidencia/soporte (cotización, CFDI, comprobante, adjunto). */
    evidenceId: uuid("evidence_id"),
    approvedAt: timestamp("approved_at").defaultNow().notNull(),

    /** Traza de invalidación ante cambio material. */
    invalidatedAt: timestamp("invalidated_at"),
    invalidatedBy: text("invalidated_by").references(() => users.id),
    invalidationReason: text("invalidation_reason"),
    changedFields: jsonb("changed_fields").$type<string[]>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    docVersionUnique: uniqueIndex("document_approvals_company_doc_version_unique").on(
      table.companyId,
      table.docType,
      table.docId,
      table.approvalVersion,
    ),
    activeApprovedUnique: uniqueIndex("document_approvals_active_approved_unique")
      .on(table.companyId, table.docType, table.docId)
      .where(sql`${table.status} = 'APPROVED'`),
    companyDocIdx: index("document_approvals_company_doc_idx").on(
      table.companyId,
      table.docType,
      table.docId,
    ),
  }),
);
