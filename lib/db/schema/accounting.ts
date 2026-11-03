import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, pgPolicy, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies, branches } from "./core";
import { users } from "./auth";
import { costCenters } from "./service-orders";
import { companyBankAccounts } from "./treasury";

// Ledger structure only. Operational classification remains in cost_centers;
// bank numbers/purpose remain in company_bank_accounts. No default mappings.
export const accountingAccounts = pgTable("accounting_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] }).notNull(),
  normalBalance: text("normal_balance", { enum: ["DEBIT", "CREDIT"] }).notNull(),
  parentId: uuid("parent_id"),
  postable: boolean("postable").default(true).notNull(),
  active: boolean("active").default(true).notNull(),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  createdBy: text("created_by").notNull().references(() => users.id),
  updatedBy: text("updated_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, table => [
  unique("accounting_accounts_company_id_unique").on(table.companyId, table.id),
  uniqueIndex("accounting_accounts_company_code_unique").on(table.companyId, table.code),
  index("accounting_accounts_parent_idx").on(table.companyId, table.parentId),
  foreignKey({ name: "accounting_accounts_parent_company_fk", columns: [table.companyId, table.parentId],
    foreignColumns: [table.companyId, table.id] }),
  check("accounting_accounts_code_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,31}$'`),
  check("accounting_accounts_name_check", sql`${table.name} = btrim(${table.name}) AND length(${table.name}) BETWEEN 1 AND 160`),
  check("accounting_accounts_kind_check", sql`${table.kind} IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')`),
  check("accounting_accounts_normal_balance_check", sql`${table.normalBalance} IN ('DEBIT','CREDIT')`),
  check("accounting_accounts_dates_check", sql`${table.validTo} IS NULL OR ${table.validTo} >= ${table.validFrom}`),
  check("accounting_accounts_parent_self_check", sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`),
  pgPolicy("accounting_accounts_tenant", { for: "all", to: "public",
    using: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid`,
    withCheck: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid` }),
]).enableRLS();

// Current catalog links, not versioned recognition rules (FC-08). A cost center
// or own bank account maps once; no sensitive bank columns are duplicated.
export const accountingSourceLinks = pgTable("accounting_source_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull(),
  accountId: uuid("account_id").notNull(),
  costCenterId: uuid("cost_center_id"),
  bankAccountId: uuid("bank_account_id"),
  createdBy: text("created_by").notNull().references(() => users.id),
  updatedBy: text("updated_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, table => [
  uniqueIndex("accounting_links_cost_center_unique").on(table.companyId, table.costCenterId),
  uniqueIndex("accounting_links_bank_unique").on(table.companyId, table.bankAccountId),
  index("accounting_links_account_idx").on(table.companyId, table.accountId),
  foreignKey({ name: "accounting_links_account_company_fk", columns: [table.companyId, table.accountId],
    foreignColumns: [accountingAccounts.companyId, accountingAccounts.id] }),
  foreignKey({ name: "accounting_links_cost_center_company_fk", columns: [table.companyId, table.costCenterId],
    foreignColumns: [costCenters.companyId, costCenters.id] }),
  foreignKey({ name: "accounting_links_bank_company_fk", columns: [table.companyId, table.bankAccountId],
    foreignColumns: [companyBankAccounts.companyId, companyBankAccounts.id] }),
  check("accounting_links_one_source_check", sql`(${table.costCenterId} IS NOT NULL) <> (${table.bankAccountId} IS NOT NULL)`),
  pgPolicy("accounting_links_tenant", { for: "all", to: "public",
    using: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid`,
    withCheck: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid` }),
]).enableRLS();

/**
 * FC-08 — recognition rules. One row is one immutable version of a rule; a
 * revision is a new row that supersedes it with its own effective date. Journals
 * record the applied rule id and version, so a later revision cannot change a
 * posted entry. Entries map a stable role (CASH, PAYABLE, …) to an account; no
 * account is assigned automatically and no rule is seeded here.
 */
export const accountingRules = pgTable("accounting_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  eventType: text("event_type").notNull(),
  version: integer("version").notNull().default(1),
  effectiveFrom: date("effective_from").notNull(),
  supersedesId: uuid("supersedes_id"),
  active: boolean("active").default(true).notNull(),
  notes: text("notes"),
  createdBy: text("created_by").notNull().references(() => users.id),
  updatedBy: text("updated_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, table => [
  unique("accounting_rules_company_id_unique").on(table.companyId, table.id),
  uniqueIndex("accounting_rules_company_code_version_unique").on(table.companyId, table.code, table.version),
  uniqueIndex("accounting_rules_company_code_from_unique").on(table.companyId, table.code, table.effectiveFrom),
  index("accounting_rules_effective_idx").on(table.companyId, table.eventType, table.effectiveFrom),
  foreignKey({ name: "accounting_rules_supersedes_company_fk", columns: [table.companyId, table.supersedesId],
    foreignColumns: [table.companyId, table.id] }),
  check("accounting_rules_code_check", sql`${table.code} ~ '^[A-Z][A-Z0-9_]{2,31}$'`),
  check("accounting_rules_event_type_check", sql`${table.eventType} ~ '^[A-Z][A-Z0-9_]{2,39}$'`),
  check("accounting_rules_name_check", sql`${table.name} = btrim(${table.name}) AND length(${table.name}) BETWEEN 1 AND 160`),
  check("accounting_rules_version_check", sql`${table.version} >= 1`),
  check("accounting_rules_supersedes_self_check", sql`${table.supersedesId} IS NULL OR ${table.supersedesId} <> ${table.id}`),
  check("accounting_rules_notes_check", sql`${table.notes} IS NULL OR (${table.notes} = btrim(${table.notes}) AND length(${table.notes}) BETWEEN 1 AND 500)`),
  pgPolicy("accounting_rules_tenant", { for: "all", to: "public",
    using: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid`,
    withCheck: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid` }),
]).enableRLS();

/** Role → account mapping of one rule version. `required` marks what a fact cannot omit. */
export const accountingRuleEntries = pgTable("accounting_rule_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull(),
  ruleId: uuid("rule_id").notNull(),
  role: text("role").notNull(),
  accountId: uuid("account_id").notNull(),
  costCenterId: uuid("cost_center_id"),
  required: boolean("required").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [
  unique("accounting_rule_entries_role_unique").on(table.companyId, table.ruleId, table.role),
  index("accounting_rule_entries_rule_idx").on(table.companyId, table.ruleId),
  foreignKey({ name: "accounting_rule_entries_rule_fk", columns: [table.companyId, table.ruleId],
    foreignColumns: [accountingRules.companyId, accountingRules.id] }).onDelete("cascade"),
  foreignKey({ name: "accounting_rule_entries_account_fk", columns: [table.companyId, table.accountId],
    foreignColumns: [accountingAccounts.companyId, accountingAccounts.id] }),
  foreignKey({ name: "accounting_rule_entries_cost_center_fk", columns: [table.companyId, table.costCenterId],
    foreignColumns: [costCenters.companyId, costCenters.id] }),
  check("accounting_rule_entries_role_check", sql`${table.role} ~ '^[A-Z][A-Z0-9_]{2,39}$'`),
  pgPolicy("accounting_rule_entries_tenant", { for: "all", to: "public",
    using: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid`,
    withCheck: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid` }),
]).enableRLS();

/**
 * Journal (póliza) header. Drafts may be unbalanced and edited with optimistic
 * `version`; posting assigns `number` and makes the row immutable. Balance,
 * account validity and overflow are re-checked inside PostgreSQL on the DRAFT →
 * POSTED transition (migration 0128), not only by the caller.
 */
export const accountingJournals = pgTable("accounting_journals", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  number: integer("number"),
  status: text("status", { enum: ["DRAFT", "POSTED"] }).notNull().default("DRAFT"),
  accountingDate: date("accounting_date").notNull(),
  businessDate: date("business_date"),
  description: text("description").notNull(),
  currency: text("currency").notNull().default("MXN"),
  branchId: uuid("branch_id"),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  sourceVersion: integer("source_version"),
  eventType: text("event_type"),
  ruleId: uuid("rule_id"),
  ruleVersion: integer("rule_version"),
  reversalOfId: uuid("reversal_of_id"),
  replacementOfId: uuid("replacement_of_id"),
  postingReason: text("posting_reason"),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => users.id),
  updatedBy: text("updated_by").notNull().references(() => users.id),
  postedBy: text("posted_by").references(() => users.id),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, table => [
  unique("accounting_journals_company_id_unique").on(table.companyId, table.id),
  uniqueIndex("accounting_journals_company_number_unique").on(table.companyId, table.number)
    .where(sql`${table.number} IS NOT NULL`),
  uniqueIndex("accounting_journals_source_unique")
    .on(table.companyId, table.sourceType, table.sourceId, table.eventType, table.sourceVersion)
    .where(sql`${table.sourceId} IS NOT NULL`),
  index("accounting_journals_business_idx").on(table.companyId, table.status, table.accountingDate),
  foreignKey({ name: "accounting_journals_reversal_company_fk", columns: [table.companyId, table.reversalOfId],
    foreignColumns: [table.companyId, table.id] }),
  foreignKey({ name: "accounting_journals_replacement_company_fk", columns: [table.companyId, table.replacementOfId],
    foreignColumns: [table.companyId, table.id] }),
  foreignKey({ name: "accounting_journals_rule_company_fk", columns: [table.companyId, table.ruleId],
    foreignColumns: [accountingRules.companyId, accountingRules.id] }),
  uniqueIndex("accounting_journals_reversal_unique").on(table.companyId, table.reversalOfId)
    .where(sql`${table.reversalOfId} IS NOT NULL`),
  uniqueIndex("accounting_journals_replacement_unique").on(table.companyId, table.replacementOfId)
    .where(sql`${table.replacementOfId} IS NOT NULL`),
  check("accounting_journals_correction_check", sql`num_nonnulls(${table.reversalOfId}, ${table.replacementOfId}) <= 1
    AND (${table.replacementOfId} IS NULL OR ${table.replacementOfId} <> ${table.id})`),
  check("accounting_journals_reason_check", sql`${table.postingReason} IS NULL OR
    (${table.postingReason} = btrim(${table.postingReason}) AND length(${table.postingReason}) BETWEEN 5 AND 500)`),
  check("accounting_journals_status_check", sql`${table.status} IN ('DRAFT','POSTED')`),
  check("accounting_journals_currency_check", sql`${table.currency} = 'MXN'`),
  check("accounting_journals_description_check", sql`${table.description} = btrim(${table.description}) AND length(${table.description}) BETWEEN 1 AND 500`),
  check("accounting_journals_number_check", sql`${table.number} IS NULL OR ${table.number} > 0`),
  check("accounting_journals_version_check", sql`${table.version} >= 1`),
  check("accounting_journals_posting_check", sql`
    (${table.status} = 'DRAFT' AND ${table.number} IS NULL AND ${table.postedAt} IS NULL AND ${table.postedBy} IS NULL)
    OR (${table.status} = 'POSTED' AND ${table.number} IS NOT NULL AND ${table.postedAt} IS NOT NULL AND ${table.postedBy} IS NOT NULL)`),
  check("accounting_journals_source_check", sql`
    num_nonnulls(${table.sourceType}, ${table.sourceId}, ${table.sourceVersion}, ${table.eventType}) IN (0, 4)
    OR (${table.sourceType} = 'OPENING' AND ${table.sourceId} IS NOT NULL
      AND ${table.sourceVersion} IS NOT NULL AND ${table.eventType} IS NULL)`),
  check("accounting_journals_source_version_check", sql`${table.sourceVersion} IS NULL OR ${table.sourceVersion} >= 1`),
  check("accounting_journals_rule_check", sql`num_nonnulls(${table.ruleId}, ${table.ruleVersion}) IN (0, 2)
    AND (${table.ruleVersion} IS NULL OR ${table.ruleVersion} >= 1)`),
  check("accounting_journals_reversal_self_check", sql`${table.reversalOfId} IS NULL OR ${table.reversalOfId} <> ${table.id}`),
  pgPolicy("accounting_journals_tenant", { for: "all", to: "public",
    using: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid`,
    withCheck: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid` }),
]).enableRLS();

/** Journal lines keep integer cents; each line posts to exactly one side. */
export const accountingJournalLines = pgTable("accounting_journal_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull(),
  journalId: uuid("journal_id").notNull(),
  lineNumber: integer("line_number").notNull(),
  accountId: uuid("account_id").notNull(),
  costCenterId: uuid("cost_center_id"),
  debitCents: bigint("debit_cents", { mode: "number" }).notNull().default(0),
  creditCents: bigint("credit_cents", { mode: "number" }).notNull().default(0),
  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [
  unique("accounting_journal_lines_number_unique").on(table.companyId, table.journalId, table.lineNumber),
  index("accounting_journal_lines_journal_idx").on(table.companyId, table.journalId),
  index("accounting_journal_lines_account_idx").on(table.companyId, table.accountId),
  foreignKey({ name: "accounting_journal_lines_journal_fk", columns: [table.companyId, table.journalId],
    foreignColumns: [accountingJournals.companyId, accountingJournals.id] }).onDelete("cascade"),
  foreignKey({ name: "accounting_journal_lines_account_fk", columns: [table.companyId, table.accountId],
    foreignColumns: [accountingAccounts.companyId, accountingAccounts.id] }),
  foreignKey({ name: "accounting_journal_lines_cost_center_fk", columns: [table.companyId, table.costCenterId],
    foreignColumns: [costCenters.companyId, costCenters.id] }),
  check("accounting_journal_lines_number_check", sql`${table.lineNumber} BETWEEN 1 AND 999`),
  check("accounting_journal_lines_side_check", sql`(${table.debitCents} > 0) <> (${table.creditCents} > 0)`),
  check("accounting_journal_lines_range_check", sql`${table.debitCents} >= 0 AND ${table.creditCents} >= 0
    AND ${table.debitCents} <= 9007199254740991 AND ${table.creditCents} <= 9007199254740991`),
  check("accounting_journal_lines_memo_check", sql`${table.memo} IS NULL OR (${table.memo} = btrim(${table.memo}) AND length(${table.memo}) BETWEEN 1 AND 200)`),
  pgPolicy("accounting_journal_lines_tenant", { for: "all", to: "public",
    using: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid`,
    withCheck: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid` }),
]).enableRLS();

/**
 * FC-08 — opening balances. One opening per company: it fixes the start date,
 * the journal that carries the balanced entry and the supporting documents
 * reviewed with the accountant. The date and journal links are frozen after
 * creation, and the opening must not overlap journals already posted on or
 * before that date.
 */
export const accountingOpenings = pgTable("accounting_openings", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  journalId: uuid("journal_id").notNull(),
  openingDate: date("opening_date").notNull(),
  memo: text("memo"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [
  unique("accounting_openings_company_id_unique").on(table.companyId, table.id),
  uniqueIndex("accounting_openings_company_unique").on(table.companyId),
  uniqueIndex("accounting_openings_journal_unique").on(table.companyId, table.journalId),
  foreignKey({ name: "accounting_openings_journal_fk", columns: [table.companyId, table.journalId],
    foreignColumns: [accountingJournals.companyId, accountingJournals.id] }),
  check("accounting_openings_memo_check", sql`${table.memo} IS NULL OR (${table.memo} = btrim(${table.memo}) AND length(${table.memo}) BETWEEN 1 AND 500)`),
  pgPolicy("accounting_openings_tenant", { for: "all", to: "public",
    using: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid`,
    withCheck: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid` }),
]).enableRLS();

/** Supporting documents of the opening. References only; no file content is copied here. */
export const accountingOpeningDocuments = pgTable("accounting_opening_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull(),
  openingId: uuid("opening_id").notNull(),
  label: text("label").notNull(),
  reference: text("reference").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [
  unique("accounting_opening_documents_label_unique").on(table.companyId, table.openingId, table.label),
  index("accounting_opening_documents_opening_idx").on(table.companyId, table.openingId),
  foreignKey({ name: "accounting_opening_documents_opening_fk", columns: [table.companyId, table.openingId],
    foreignColumns: [accountingOpenings.companyId, accountingOpenings.id] }).onDelete("cascade"),
  check("accounting_opening_documents_label_check", sql`${table.label} = btrim(${table.label}) AND length(${table.label}) BETWEEN 1 AND 120`),
  check("accounting_opening_documents_reference_check", sql`${table.reference} = btrim(${table.reference}) AND length(${table.reference}) BETWEEN 1 AND 200`),
  check("accounting_opening_documents_amount_check", sql`${table.amountCents} IS NULL OR (${table.amountCents} >= 0 AND ${table.amountCents} <= 9007199254740991)`),
  pgPolicy("accounting_opening_documents_tenant", { for: "all", to: "public",
    using: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid`,
    withCheck: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid` }),
]).enableRLS();

/** Durable outbox: identity only; sensitive operational data stays at its source. */
export const accountingEvents = pgTable("accounting_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  branchId: uuid("branch_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  eventType: text("event_type").notNull(),
  sourceVersion: integer("source_version").default(1).notNull(),
  actorId: text("actor_id").notNull().references(() => users.id),
  accountingDate: date("accounting_date"),
  status: text("status", { enum: ["PENDING", "POSTED"] }).default("PENDING").notNull(),
  journalId: uuid("journal_id"),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex("accounting_events_source_unique").on(table.companyId, table.sourceType, table.sourceId, table.eventType, table.sourceVersion),
  index("accounting_events_pending_idx").on(table.companyId, table.status, table.nextAttemptAt, table.id),
  foreignKey({ name: "accounting_events_branch_fk", columns: [table.branchId],
    foreignColumns: [branches.id] }),
  foreignKey({ name: "accounting_events_journal_fk", columns: [table.companyId, table.journalId],
    foreignColumns: [accountingJournals.companyId, accountingJournals.id] }),
  check("accounting_events_source_check", sql`(${table.sourceType} = 'OPERATING_EXPENSE' AND ${table.eventType} = 'EXPENSE_RECOGNIZED')
    OR (${table.sourceType} = 'EXPENSE_PAYMENT' AND ${table.eventType} = 'EXPENSE_PAYMENT')`),
  check("accounting_events_version_check", sql`${table.sourceVersion} = 1`),
  check("accounting_events_attempts_check", sql`${table.attempts} >= 0`),
  check("accounting_events_status_check", sql`(${table.status} = 'PENDING' AND ${table.journalId} IS NULL)
    OR (${table.status} = 'POSTED' AND ${table.journalId} IS NOT NULL AND ${table.lastError} IS NULL)`),
  check("accounting_events_error_check", sql`${table.lastError} IS NULL OR length(${table.lastError}) BETWEEN 1 AND 500`),
  pgPolicy("accounting_events_tenant", { for: "all", to: "public",
    using: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid`,
    withCheck: sql`${table.companyId} = nullif(current_setting('app.current_company_id', true),'')::uuid` }),
]).enableRLS();
