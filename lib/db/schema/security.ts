/**
 * Pilar 1–4 security schema — Sprint Sec-0.
 *
 * Source: docs/pulso-executive-os-security.md §11 (Schema Nuevo Requerido).
 *
 * Tables added in Sec-0 (no service logic depends on them yet; they are the
 * substrate that Sprints 1–4 fill):
 *  - tenant_keys        (Pilar 2): per-company Data Encryption Key, encrypted by KEK.
 *  - data_access_logs   (§9): audit of READ/EXPORT/UPDATE/DELETE on classified data.
 *  - data_consents      (Pilar 3 §7.2): LFPDPPP consent registry.
 *  - privacy_notices    (Pilar 3 §7.2): versioned privacy notice.
 *  - arco_requests      (Pilar 3 §7.3): ARCO rights workflow (20 business-day SLA).
 *  - payment_approvals  (Pilar 1 §5.4): dual approval for payments above threshold.
 *
 * NOTE on `tenant_keys.encrypted_dek`: stored as the output of `pgp_sym_encrypt(dek, KEK)`
 * (lib/crypto). It is opaque `bytea` to Postgres; the KEK never enters the DB.
 */
import { pgTable, text, timestamp, boolean, uuid, jsonb, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, branches } from "./core";
import { users } from "./auth";

/** Pilar 2 — per-tenant Data Encryption Key envelope. */
export const tenantKeys = pgTable("tenant_keys", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id),
  /** DEK ciphertext: base64 of `pgp_sym_encrypt(dek, :kek)` output. Decrypted only in app runtime. */
  encryptedDek: text("encrypted_dek").notNull(),
  dekVersion: integer("dek_version").default(1).notNull(),
  rotatedAt: timestamp("rotated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** §9.1 — General audit log for access to classified data (not only employee mutations). */
export const dataAccessLogs = pgTable("data_access_logs", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  userId: text("user_id").notNull(), // actor
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").references(() => branches.id),

  action: text("action").notNull(), // 'READ' | 'EXPORT' | 'UPDATE' | 'DELETE' | 'APPROVE'
  resource: text("resource").notNull(), // e.g. 'employees.clabe' | 'corporate_twins' | 'cfdi_invoices'
  resourceId: text("resource_id"),

  accessDecision: jsonb("access_decision"), // snapshot of AccessDecision (incl. reason on deny)
  redactedFields: text("redacted_fields"), // CSV of fields masked in the response
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  performedAt: timestamp("performed_at").defaultNow().notNull(),

  retentionUntil: timestamp("retention_until"),
});

/** Pilar 3 §7.2 — LFPDPPP consent registry. */
export const dataConsents = pgTable("data_consents", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  userId: text("user_id").notNull().references(() => users.id),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  privacyNoticeVersion: text("privacy_notice_version").notNull(), // e.g. "v1.0"
  consentType: text("consent_type").notNull(), // 'EMPLOYMENT' | 'PAYROLL' | 'MONITORING'
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  proofDocumentId: uuid("proof_document_id"),
});

/** Pilar 3 §7.2 — Versioned privacy notice. Nullable company_id = system default. */
export const privacyNotices = pgTable("privacy_notices", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  version: text("version").notNull().unique(),
  companyId: uuid("company_id").references(() => companies.id),
  contentUrl: text("content_url").notNull(), // R2 / stored PDF
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  active: boolean("active").default(true).notNull(),
});

/** Pilar 3 §7.3 — ARCO rights requests (Art. 32: 20 business-day SLA). */
export const arcoRequests = pgTable("arco_requests", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  userId: text("user_id").notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  requestType: text("request_type").notNull(), // 'ACCESS' | 'RECTIFY' | 'CANCEL' | 'OPPOSE'
  description: text("description"),
  status: text("status").default('PENDING').notNull(), // PENDING|IN_REVIEW|FULFILLED|REJECTED
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  fulfilledAt: timestamp("fulfilled_at"),
  fulfilledBy: text("fulfilled_by"),
  responseDocumentId: uuid("response_document_id"),
});

/** Pilar 1 §5.4 — Dual approval for payments above a configurable threshold. */
export const paymentApprovals = pgTable("payment_approvals", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").references(() => branches.id),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").default('MXN').notNull(),
  /** What is being approved — opaque reference (payroll run id, invoice id, ...). */
  paymentRef: text("payment_ref").notNull(),
  paymentRefType: text("payment_ref_type").notNull(), // 'PAYROLL' | 'INVOICE' | 'MANUAL'
  status: text("status").default('PENDING').notNull(), // PENDING|APPROVED|REJECTED|EXECUTED
  requestedBy: text("requested_by").notNull(),
  approvedBy: text("approved_by"),
  secondApprovedBy: text("second_approved_by"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  approvedAt: timestamp("approved_at"),
  executedAt: timestamp("executed_at"),
  notes: text("notes"),
});