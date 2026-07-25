import { pgTable, text, timestamp, boolean, uuid, jsonb, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";

// Companies table - Core entity for multi-tenant architecture
export const companies = pgTable("companies", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  name: text("name").notNull(),
  taxId: text("tax_id"),
  plan: text("plan").default('FREE'),
  billingStatus: text("billing_status").default('ACTIVE'),
  stripeCustomerId: text("stripe_customer_id"),
  blindStockCount: boolean("blind_stock_count").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Branches table - Locations within a company
export const branches = pgTable("branches", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id"),
  name: text("name").notNull(),
  address: text("address"),
  timezone: text("timezone").default('America/Mexico_City'),
  operatingHours: jsonb("operating_hours"),
  location: jsonb("location"),
  managerId: text("manager_id"),
  inviteToken: uuid("invite_token").default(sql`gen_random_uuid()`),
  managerInviteToken: uuid("manager_invite_token").default(sql`gen_random_uuid()`),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => {
  return {
    branchesInviteTokenUnique: uniqueIndex("branches_invite_token_unique").on(table.inviteToken),
    branchesManagerInviteTokenUnique: uniqueIndex("branches_manager_invite_token_unique").on(table.managerInviteToken),
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
