import { pgTable, text, timestamp, boolean, uuid, jsonb, uniqueIndex, foreignKey, integer, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";

/**
 * Pilar 4 — Aislamiento sucursales propias vs franquiciadas.
 *OWNED = sucursal operada por el grupo; FRANCHISE = operada por un franquiciatario.
 * See docs/pulso-executive-os-security.md §8. Without this, a franchise manager
 * with `users: ['read']` can read employees of any branch in the company.
 */
export const branchOwnershipEnum = pgEnum("branch_ownership", ['OWNED', 'FRANCHISE']);

// Companies table - Core entity for multi-tenant architecture
export const companies = pgTable("companies", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  name: text("name").notNull(),
  taxId: text("tax_id"),
  plan: text("plan").default('FREE'),
  billingStatus: text("billing_status").default('ACTIVE'),
  stripeCustomerId: text("stripe_customer_id"),
  blindStockCount: boolean("blind_stock_count").default(false),
  // Task 3 (plan-loteprod-gaps §8.1): tope mensual de mermas STAFF/COURTESY en
  // centavos, a nivel empresa. Null = sin tope: cualquier GERENTE aprueba.
  courtesyWasteMonthlyCapCents: integer("courtesy_waste_monthly_cap_cents"),
  costingMethod: text("costing_method").default('LAST_PRICE'), // 'LAST_PRICE' | 'AVERAGE_COST'
  taxRate: integer("tax_rate").default(16), // IVA percentage default 16%
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Branches table - Locations within a company
export const branches = pgTable("branches", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id"),
  name: text("name").notNull(),
  // Código corto de sucursal para folios documentales (OC-CDMX01-2026-0045).
  // Catálogo maestro (finzasordenes.md §2): único por empresa, configurable por el admin.
  code: text("code"),
  address: text("address"),
  timezone: text("timezone").default('America/Mexico_City'),
  operatingHours: jsonb("operating_hours"),
  location: jsonb("location"),
  managerId: text("manager_id"),
  inviteToken: uuid("invite_token").default(sql`gen_random_uuid()`),
  managerInviteToken: uuid("manager_invite_token").default(sql`gen_random_uuid()`),
  active: boolean("active").default(true),
  costingMethod: text("costing_method"), // 'LAST_COST' | 'AVERAGE_COST' — overrides company default

  // ── Pilar 4: franchise isolation (docs §8.2) ──
  ownershipType: branchOwnershipEnum("ownership_type").default('OWNED').notNull(),
  /** If FRANCHISE, the Pulso user_id of the franchisee responsible for this branch. */
  franchiseeUserId: text("franchisee_user_id"),
  /** External reference to the franchise agreement (contract id). */
  franchiseAgreementRef: text("franchise_agreement_ref"),
  /** Commercial config: royalty percent paid to the franchisor (0–100). */
  franchiseRoyaltyPercent: integer("franchise_royalty_percent"),

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => {
  return {
    branchesInviteTokenUnique: uniqueIndex("branches_invite_token_unique").on(table.inviteToken),
    branchesManagerInviteTokenUnique: uniqueIndex("branches_manager_invite_token_unique").on(table.managerInviteToken),
    // Único solo cuando code está asignado (NULL no participa en el índice parcial)
    branchesCompanyCodeUnique: uniqueIndex("branches_company_code_unique")
      .on(table.companyId, table.code)
      .where(sql`code is not null`),
    branchesManagerIdFk: foreignKey({
      columns: [table.managerId],
      foreignColumns: [users.id],
      name: "branches_manager_id_fkey"
    }),
  };
});

// Holidays table - Company-wide and branch-specific holidays
export const holidays = pgTable("holidays", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  date: text("date").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
